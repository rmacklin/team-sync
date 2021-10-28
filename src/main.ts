import * as core from '@actions/core'
import * as github from '@actions/github'
import {Octokit} from '@octokit/rest'
import slugify from '@sindresorhus/slugify'
import * as yaml from 'js-yaml'

interface RepositoryMatch {
  name?: string
  regex_match?: RegExp
  regex_ignore?: RegExp
  permission: string
}

interface RepositoryPermission {
  name: string
  permission: string
}

interface TeamData {
  members: string[]
  team_sync_ignored?: boolean
  description?: string
  repos: RepositoryMatch[]
}

async function run(): Promise<void> {
  try {
    const token = core.getInput('repo-token', {required: true})
    const teamDataPath = core.getInput('team-data-path')
    const teamNamePrefix = core.getInput('prefix-teams-with')

    const client = github.getOctokit(token)
    const org = github.context.repo.owner

    core.debug('Fetching authenticated user')
    const authenticatedUserResponse = await client.rest.users.getAuthenticated()
    const authenticatedUser = authenticatedUserResponse.data.login
    core.debug(`GitHub client is authenticated as ${authenticatedUser}`)

    core.debug(`Fetching team data from ${teamDataPath}`)
    const teamDataContent = await fetchContent(client, teamDataPath)

    core.debug(`raw teams config:\n${teamDataContent}`)

    const teams = parseTeamData(teamDataContent)

    core.debug(
      `Parsed teams configuration into this mapping of team names to team data: ${JSON.stringify(
        Object.fromEntries(teams)
      )}`
    )

    await synchronizeTeamData(client, org, authenticatedUser, teams, teamNamePrefix)
  } catch (error) {
    core.error(error as Error)
    core.setFailed((error as Error).message)
  }
}

async function synchronizeTeamData(
  client: any,
  org: string,
  authenticatedUser: string,
  teams: Map<string, TeamData>,
  teamNamePrefix: string
): Promise<void> {
  for (const [unprefixedTeamName, teamData] of teams.entries()) {
    const teamName = prefixName(unprefixedTeamName, teamNamePrefix)
    const teamSlug = slugify(teamName, {decamelize: false})

    if (teamData.team_sync_ignored) {
      core.debug(`Ignoring team ${unprefixedTeamName} due to its team_sync_ignored property`)
      continue
    }

    const {description, members: desiredMembers, repos: desiredRepoExpressions} = teamData

    core.debug(`Desired team members for team slug ${teamSlug}:`)
    core.debug(JSON.stringify(desiredMembers))

    const {existingTeam, existingRepos, existingMembers, desiredRepos} = await getExistingTeamReposAndMembers(client, org, teamSlug, desiredRepoExpressions)

    if (existingTeam) {
      core.debug(`Existing team members for team slug ${teamSlug}:`)
      core.debug(JSON.stringify(existingMembers))

      await client.rest.teams.updateInOrg({org, team_slug: teamSlug, name: teamName, description})
      await removeFormerTeamMembers(client, org, teamSlug, existingMembers, desiredMembers)
      await removeFormerTeamRepos(client, org, teamSlug, existingRepos, desiredRepos)
      //await removeFormerRepositories(client, org, teamSlug, )
    } else {
      core.debug(`No team was found in ${org} with slug ${teamSlug}. Creating one.`)
      await createTeamWithNoMembers(client, org, teamName, teamSlug, authenticatedUser, description)
    }

    await addNewTeamRepos(client, org, teamSlug, existingRepos, desiredRepos)
    await addNewTeamMembers(client, org, teamSlug, existingMembers, desiredMembers)
  }
}

function parseTeamData(rawTeamConfig: string): Map<string, TeamData> {
  const teamsData = JSON.parse(JSON.stringify(yaml.safeLoad(rawTeamConfig)))
  const unexpectedFormatError = new Error(
    'Unexpected team data format (expected an object mapping team names to team metadata)'
  )

  if (typeof teamsData !== 'object') {
    throw unexpectedFormatError
  }

  const teams: Map<string, TeamData> = new Map()
  for (const teamName in teamsData) {
    const teamData = teamsData[teamName]

    if (teamData.members) {
      const {members, repos} = teamData

      const teamGitHubUsernames: string[] = []
      if (Array.isArray(members)) {
        for (const member of members) {
          if (typeof member.github === 'string') {
            teamGitHubUsernames.push(member.github)
          } else {
            throw new Error(`Invalid member data encountered within team ${teamName}`)
          }
        }
      }

      const teamRepos: RepositoryMatch[] = []
      if(Array.isArray(repos)) {
        for (const repo of repos) {
            const tt : RepositoryMatch = {permission: repo.permission || "write"}
            if(repo.name) tt.name = repo.name
            if(repo.regex_ignore) tt.regex_ignore = new RegExp(repo.regex_ignore)
            if(repo.regex_match) tt.regex_match = new RegExp(repo.regex_match)

          if (repo.name || repo.regex_match || repo.regex_ignore) {
            teamRepos.push(tt)
          } else {
            throw new Error(`Invalid repo data encountered within team ${teamName}`)
          }
        }
      }

      const parsedTeamData: TeamData = {members: teamGitHubUsernames, repos: teamRepos}

      if ('description' in teamData) {
        const {description} = teamData

        if (typeof description === 'string') {
          parsedTeamData.description = description
        } else {
          throw new Error(`Invalid description property for team ${teamName} (expected a string)`)
        }
      }

      if ('team_sync_ignored' in teamData) {
        const {team_sync_ignored} = teamData

        if (typeof team_sync_ignored === 'boolean') {
          parsedTeamData.team_sync_ignored = team_sync_ignored
        } else {
          throw new Error(
            `Invalid team_sync_ignored property for team ${teamName} (expected a boolean)`
          )
        }
      }

      teams.set(teamName, parsedTeamData)
      continue
    }
  }

  return teams
}

function prefixName(unprefixedName: string, prefix: string): string {
  const trimmedPrefix = prefix.trim()

  return trimmedPrefix === '' ? unprefixedName : `${trimmedPrefix} ${unprefixedName}`
}

async function removeFormerTeamMembers(
  client: any,
  org: string,
  teamSlug: string,
  existingMembers: string[],
  desiredMembers: string[]
): Promise<void> {
  for (const username of existingMembers) {
    if (!desiredMembers.includes(username)) {
      core.debug(`Removing ${username} from ${teamSlug}`)
      await client.rest.teams.removeMembershipInOrg({org, team_slug: teamSlug, username})
    } else {
      core.debug(`Keeping ${username} in ${teamSlug}`)
    }
  }
}

function permissionTranslate(p : any) : string {
  if(p.admin) return "admin"
  if(p.push) return "push"
  return "pull"
}

async function removeFormerTeamRepos(
  client: any,
  org: string,
  teamSlug: string,
  existingRepos: RepositoryPermission[],
  desiredRepos: RepositoryPermission[]
): Promise<void> {
  for (const r of existingRepos) {
    const [owner, repo] = r.name.split('/')
    if (!desiredRepos.find(a=>(a.name == r.name && a.permission == r.permission))) {
      core.debug(`Removing ${r.name}/${r.permission} from ${teamSlug}`)
      await client.rest.teams.removeRepoInOrg({org, team_slug: teamSlug, owner, repo})
    } else {
      core.debug(`Keeping ${r.name} in ${teamSlug}`)
    }
  }
}

async function addNewTeamRepos(
  client: any,
  org: string,
  teamSlug: string,
  existingRepos: RepositoryPermission[],
  desiredRepos: RepositoryPermission[]
): Promise<void> {
  for (const r of desiredRepos) {
    if (!existingRepos.find(a=>(a.name == r.name && a.permission == r.permission))) {
      core.debug(`Adding ${r.name}/${r.permission} to ${teamSlug}`)
      const [owner, repo] = r.name.split('/')
      await client.rest.teams.addOrUpdateRepoPermissionsInOrg({org, team_slug: teamSlug, owner, repo, permission: r.permission as "pull" | "push" | "admin"})
    }
  }
}

async function addNewTeamMembers(
  client: any,
  org: string,
  teamSlug: string,
  existingMembers: string[],
  desiredMembers: string[]
): Promise<void> {
  for (const username of desiredMembers) {
    if (!existingMembers.includes(username)) {
      core.debug(`Adding ${username} to ${teamSlug}`)
      await client.rest.teams.addOrUpdateMembershipInOrg({org, team_slug: teamSlug, username})
    }
  }
}

async function createTeamWithNoMembers(
  client: any,
  org: string,
  teamName: string,
  teamSlug: string,
  authenticatedUser: string,
  description?: string
): Promise<void> {
  await client.rest.teams.create({org, name: teamName, description, privacy: 'closed'})

  core.debug(`Removing creator (${authenticatedUser}) from ${teamSlug}`)

  await client.teams.removeMembershipInOrg({
    org,
    team_slug: teamSlug,
    username: authenticatedUser
  })
}

//const desiredRepos: RepositoryPermission[] = desiredRepoExpressions.map(m => ({name:m.name, permission:m.permission}))

async function getExistingTeamReposAndMembers(
  client: any,
  org: string,
  teamSlug: string,
  desredRepoExpressions: RepositoryMatch[]
): Promise<{
  existingTeam: Octokit.TeamsGetByNameResponse | null
  existingRepos: RepositoryPermission[],
  existingMembers: string[],
  desiredRepos: RepositoryPermission[]
}> {
  let existingTeam
  let existingMembers: string[] = []
  let existingRepos: RepositoryPermission[] = []
  let desiredRepos: RepositoryPermission[] = []

  try {
    const teamResponse = await client.rest.teams.getByName({org, team_slug: teamSlug})

    existingTeam = teamResponse.data

    const membersResponse = await client.rest.teams.listMembersInOrg({org, team_slug: teamSlug})

    existingMembers = membersResponse.data.map((m : any) => m.login)

    const reposResponse = await client.rest.teams.listReposInOrg({org, team_slug: teamSlug})

    existingRepos = reposResponse.data.map((r : any) => ({name: r.full_name, permission: permissionTranslate(r.permissions)}))

    const orgRepos = await client.paginate(client.rest.repos.listForOrg, {org})
    core.debug(`Got ${orgRepos.length} repos`)
    for(const r of orgRepos){
      let ff = desredRepoExpressions.filter(a=>{
        if(a.regex_ignore){
          if(a.regex_ignore.test(r.full_name)){
            return false
          }
        }
        if(a.name == r.full_name) return true;
        if(a.regex_match){
          if(a.regex_match.test(r.full_name)){
            return true
          }
        }
        return false;
      })
      for(const f of ff){
        desiredRepos.push({name: r.full_name, permission: f.permission})
      }
    }

  } catch (error) {
    core.debug(`${error}`)
    existingTeam = null
  }

  return {existingTeam, existingRepos, desiredRepos, existingMembers}
}

async function fetchContent(client: any, repoPath: string): Promise<string> {
  const response = await client.rest.repos.getContent({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    path: repoPath,
    ref: github.context.sha
  })

  if (Array.isArray(response.data)) {
    throw new Error('path must point to a single file, not a directory')
  }

  const {content, encoding} = response.data

  if (typeof content !== 'string' || encoding !== 'base64') {
    throw new Error('Octokit.repos.getContents returned an unexpected response')
  }

  return Buffer.from(content, encoding).toString()
}

run()

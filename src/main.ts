import * as core from '@actions/core'
import * as github from '@actions/github'
import slugify from '@sindresorhus/slugify'

interface TeamData {
  members: string[]
  team_sync_ignored?: boolean
  description?: string
}

async function run(): Promise<void> {
  try {
    const token = core.getInput('repo-token', {required: true})
    const teamDataPath = core.getInput('team-data-path')
    const teamNamePrefix = core.getInput('prefix-teams-with')

    const client = new github.GitHub(token)
    const org = github.context.repo.owner

    core.debug('Fetching authenticated user')
    const authenticatedUserResponse = await client.users.getAuthenticated()
    const authenticatedUser = authenticatedUserResponse.data.login
    core.debug(`GitHub client is authenticated as ${authenticatedUser}`)

    core.debug(`Fetching team data from ${teamDataPath}`)
    const teamDataContent = await fetchContent(client, teamDataPath)
    const teams = parseTeamData(teamDataContent)

    core.debug(
      `Parsed teams configuration into this mapping of team names to team data: ${JSON.stringify(
        Object.fromEntries(teams)
      )}`
    )

    await synchronizeTeamData(client, org, authenticatedUser, teams, teamNamePrefix)
  } catch (error) {
    core.error(error)
    core.setFailed(error.message)
  }
}

async function synchronizeTeamData(
  client: github.GitHub,
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

    const {description, members: desiredMembers} = teamData

    core.debug(`Desired team members for team slug ${teamSlug}:`)
    core.debug(JSON.stringify(desiredMembers))

    const {existingTeam, existingMembers} = await getExistingTeamAndMembers(client, org, teamSlug)

    if (existingTeam) {
      core.debug(`Existing team members for team slug ${teamSlug}:`)
      core.debug(JSON.stringify(existingMembers))

      await client.teams.updateInOrg({org, team_slug: teamSlug, name: teamName, description})
      await removeFormerTeamMembers(client, org, teamSlug, existingMembers, desiredMembers)
    } else {
      core.debug(`No team was found in ${org} with slug ${teamSlug}. Creating one.`)
      await createTeamWithNoMembers(client, org, teamName, teamSlug, authenticatedUser, description)
    }

    await addNewTeamMembers(client, org, teamSlug, existingMembers, desiredMembers)
  }
}

function parseTeamData(rawTeamConfig: string): Map<string, TeamData> {
  const teamsData = JSON.parse(rawTeamConfig)
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
      const {members} = teamData

      if (Array.isArray(members)) {
        const teamGitHubUsernames: string[] = []

        for (const member of members) {
          if (typeof member.github === 'string') {
            teamGitHubUsernames.push(member.github)
          } else {
            throw new Error(`Invalid member data encountered within team ${teamName}`)
          }
        }

        const parsedTeamData: TeamData = {members: teamGitHubUsernames}

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

    throw unexpectedFormatError
  }

  return teams
}

function prefixName(unprefixedName: string, prefix: string): string {
  const trimmedPrefix = prefix.trim()

  return trimmedPrefix === '' ? unprefixedName : `${trimmedPrefix} ${unprefixedName}`
}

async function removeFormerTeamMembers(
  client: github.GitHub,
  org: string,
  teamSlug: string,
  existingMembers: string[],
  desiredMembers: string[]
): Promise<void> {
  for (const username of existingMembers) {
    if (!desiredMembers.includes(username)) {
      core.debug(`Removing ${username} from ${teamSlug}`)
      await client.teams.removeMembershipInOrg({org, team_slug: teamSlug, username})
    } else {
      core.debug(`Keeping ${username} in ${teamSlug}`)
    }
  }
}

async function addNewTeamMembers(
  client: github.GitHub,
  org: string,
  teamSlug: string,
  existingMembers: string[],
  desiredMembers: string[]
): Promise<void> {
  for (const username of desiredMembers) {
    if (!existingMembers.includes(username)) {
      core.debug(`Adding ${username} to ${teamSlug}`)
      await client.teams.addOrUpdateMembershipInOrg({org, team_slug: teamSlug, username})
    }
  }
}

async function createTeamWithNoMembers(
  client: github.GitHub,
  org: string,
  teamName: string,
  teamSlug: string,
  authenticatedUser: string,
  description?: string
): Promise<void> {
  await client.teams.create({org, name: teamName, description, privacy: 'closed'})

  core.debug(`Removing creator (${authenticatedUser}) from ${teamSlug}`)

  await client.teams.removeMembershipInOrg({
    org,
    team_slug: teamSlug,
    username: authenticatedUser
  })
}

async function getExistingTeamAndMembers(
  client: github.GitHub,
  org: string,
  teamSlug: string
): Promise<any> {
  let existingTeam
  let existingMembers: string[] = []

  try {
    const teamResponse = await client.teams.getByName({org, team_slug: teamSlug})

    existingTeam = teamResponse.data

    const membersResponse = await client.teams.listMembersInOrg({org, team_slug: teamSlug})

    existingMembers = membersResponse.data.map(m => m.login)
  } catch (error) {
    existingTeam = null
  }

  return {existingTeam, existingMembers}
}

async function fetchContent(client: github.GitHub, repoPath: string): Promise<string> {
  const response = await client.repos.getContents({
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

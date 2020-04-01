import * as core from '@actions/core'
import * as github from '@actions/github'
import slugify from '@sindresorhus/slugify'

async function run(): Promise<void> {
  try {
    const token = core.getInput('repo-token', {required: true})
    const teamDataPath = core.getInput('team-data-path')

    const client = new github.GitHub(token)
    const org = github.context.repo.owner

    core.debug('Fetching authenticated user')
    const authenticatedUserResponse = await client.users.getAuthenticated()
    const authenticatedUser: string = authenticatedUserResponse.data.login
    core.debug(`GitHub client is authenticated as ${authenticatedUser}`)

    core.debug(`Fetching team data from ${teamDataPath}`)
    const teams: any = await getTeamData(client, teamDataPath)

    core.debug(`teams: ${JSON.stringify(teams)}`)

    await synchronizeTeamData(client, org, teams)
  } catch (error) {
    core.error(error)
    core.setFailed(error.message)
  }
}

async function synchronizeTeamData(client: github.GitHub, org: string, teams: any): Promise<void> {
  for (const teamName of Object.keys(teams)) {
    const teamSlug = slugify(teamName, {decamelize: false})
    const desiredMembers: string[] = teams[teamName].members.map((m: any) => m.github)

    core.debug(`Desired team members for team slug ${teamSlug}:`)
    core.debug(JSON.stringify(desiredMembers))

    const {existingTeam, existingMembers} = await getExistingTeamAndMembers(client, org, teamSlug)

    if (existingTeam) {
      core.debug(`Existing team members for team slug ${teamSlug}:`)
      core.debug(JSON.stringify(existingMembers))
    } else {
      core.debug(`No team was found in ${org} with slug ${teamSlug}.`)
    }
  }
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

async function getTeamData(client: github.GitHub, teamDataPath: string): Promise<any> {
  const teamDataContent: string = await fetchContent(client, teamDataPath)

  return JSON.parse(teamDataContent)
}

async function fetchContent(client: github.GitHub, repoPath: string): Promise<string> {
  const response: any = await client.repos.getContents({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    path: repoPath,
    ref: github.context.sha
  })

  return Buffer.from(response.data.content, response.data.encoding).toString()
}

run()

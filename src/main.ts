import * as core from '@actions/core'
import github from '@actions/github'
import {getTeamData} from './get-team-data'
import {synchronizeTeamData} from './sync'

async function run(): Promise<void> {
  try {
    const token = core.getInput('token')
    const teamDataPath = core.getInput('team-data-path')
    const teamNamePrefix = core.getInput('prefix-teams-with')

    const client = github.getOctokit(token).rest
    const org = github.context.repo.owner

    core.debug('Fetching authenticated user')
    const authenticatedUserResponse = await client.users.getAuthenticated()
    const authenticatedUser = authenticatedUserResponse.data.login
    core.debug(`GitHub client is authenticated as ${authenticatedUser}`)

    core.debug(`Fetching team data from ${teamDataPath}`)
    const teams = await getTeamData(client, teamDataPath)

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

run()

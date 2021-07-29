import {RestEndpointMethods} from '@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types'
import slugify from '@sindresorhus/slugify'
import * as core from '@actions/core'
import {TeamData} from "./team-data";

export async function synchronizeTeamData(
  client: RestEndpointMethods,
  org: string,
  authenticatedUser: string,
  teams: TeamData,
  teamNamePrefix: string
): Promise<void> {
  for (const unprefixedTeamName of Object.keys(teams)) {
    const teamName = prefixName(unprefixedTeamName, teamNamePrefix)
    const teamSlug = slugify(teamName, {decamelize: false})
    const teamData = teams[unprefixedTeamName]

    if (teamData.team_sync_ignored) {
      core.debug(`Ignoring team ${unprefixedTeamName} due to its team_sync_ignored property`)
      continue
    }

    const description = teamData.description
    const desiredMembers: string[] = teamData.members.map((m: any) => m.github)

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

function prefixName(unprefixedName: string, prefix: string): string {
  const trimmedPrefix = prefix.trim()

  return trimmedPrefix === '' ? unprefixedName : `${trimmedPrefix} ${unprefixedName}`
}

async function removeFormerTeamMembers(
  client: RestEndpointMethods,
  org: string,
  teamSlug: string,
  existingMembers: string[],
  desiredMembers: string[]
): Promise<void> {
  for (const username of existingMembers) {
    if (!desiredMembers.includes(username)) {
      core.debug(`Removing ${username} from ${teamSlug}`)
      await client.teams.removeMembershipForUserInOrg({org, team_slug: teamSlug, username})
    } else {
      core.debug(`Keeping ${username} in ${teamSlug}`)
    }
  }
}

async function addNewTeamMembers(
  client: RestEndpointMethods,
  org: string,
  teamSlug: string,
  existingMembers: string[],
  desiredMembers: string[]
): Promise<void> {
  for (const username of desiredMembers) {
    if (!existingMembers.includes(username)) {
      core.debug(`Adding ${username} to ${teamSlug}`)
      await client.teams.addOrUpdateMembershipForUserInOrg({org, team_slug: teamSlug, username})
    }
  }
}

async function createTeamWithNoMembers(
  client: RestEndpointMethods,
  org: string,
  teamName: string,
  teamSlug: string,
  authenticatedUser: string,
  description?: string
): Promise<void> {
  await client.teams.create({org, name: teamName, description, privacy: 'closed'})

  core.debug(`Removing creator (${authenticatedUser}) from ${teamSlug}`)

  await client.teams.removeMembershipForUserInOrg({
    org,
    team_slug: teamSlug,
    username: authenticatedUser
  })
}

async function getExistingTeamAndMembers(
  client: RestEndpointMethods,
  org: string,
  teamSlug: string
): Promise<any> {
  let existingTeam
  let existingMembers: string[] = []

  try {
    const teamResponse = await client.teams.getByName({org, team_slug: teamSlug})

    existingTeam = teamResponse.data

    const membersResponse = await client.teams.listMembersInOrg({org, team_slug: teamSlug})

    existingMembers = membersResponse.data
      .map(m => m?.login)
      .filter(x => x != undefined) as string[]
  } catch (error) {
    existingTeam = null
  }

  return {existingTeam, existingMembers}
}

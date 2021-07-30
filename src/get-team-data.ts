import {RestEndpointMethods} from '@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types'
import {TeamData} from './team-data'
import github from '@actions/github'
import yaml from 'js-yaml'

export async function getTeamData(
  client: RestEndpointMethods,
  teamDataPath: string
): Promise<TeamData> {
  const teamDataContent: string = await fetchContent(client, teamDataPath)

  if (teamDataPath.toLowerCase().endsWith('.json')) {
    return JSON.parse(teamDataContent)
  } else {
    return (yaml.load(teamDataContent) || {}) as TeamData
  }
}

async function fetchContent(client: RestEndpointMethods, repoPath: string): Promise<string> {
  const response = await client.repos.getContent({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    path: repoPath,
    ref: github.context.sha
  })

  if (Array.isArray(response.data)) {
    throw new Error('path must point to a single file, not a directory')
  }

  const {content, encoding} = response.data as any

  if (typeof content !== 'string' || !Buffer.isEncoding(encoding)) {
    throw new Error('Octokit.repos.getContents returned an unexpected response')
  }

  return Buffer.from(content, encoding).toString()
}

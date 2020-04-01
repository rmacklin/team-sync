import * as core from '@actions/core'
import * as github from '@actions/github'

async function run(): Promise<void> {
  try {
    const token = core.getInput('repo-token', {required: true})
    const teamDataPath = core.getInput('team-data-path')

    const client = new github.GitHub(token)

    core.debug(`Fetching team data from ${teamDataPath}`)
    const teams: any = await getTeamData(client, teamDataPath)

    core.debug(`teams: ${JSON.stringify(teams)}`)
  } catch (error) {
    core.error(error)
    core.setFailed(error.message)
  }
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

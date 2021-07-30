import {expect, jest, test, describe} from '@jest/globals'
import {getTeamData} from '../src/get-team-data'

jest.mock('@actions/github', () => {
  return {
    context: {
      repo: {
        owner: 'owner',
        repo: 'repo'
      }
    }
  }
})

describe('get-team-data', () => {
  test('throws invalid json', async () => {
    const client = {
      repos: {getContent: jest.fn()}
    } as any
    client.repos.getContent.mockReturnValue({data: {content: '', encoding: 'utf8'}})
    await expect(getTeamData(client, 'input.json')).rejects.toThrow('Unexpected end of JSON input')
  })

  test('read empty file', () => {
    const client = {
      repos: {getContent: jest.fn()}
    } as any
    client.repos.getContent.mockReturnValue({data: {content: '{}', encoding: 'utf8'}})
    expect(getTeamData(client, 'input.json')).resolves.toEqual({})
  })

  test('read empty yaml file', () => {
    const client = {
      repos: {getContent: jest.fn()}
    } as any
    client.repos.getContent.mockReturnValue({data: {content: '---', encoding: 'utf8'}})
    expect(getTeamData(client, 'input.yml')).resolves.toEqual({})
  })

  test('read yaml file', () => {
    const client = {
      repos: {getContent: jest.fn()}
    } as any
    client.repos.getContent.mockReturnValue({
      data: {
        content: `
  a-team:
    description: desc
    slack: slack
    members:
    - name: hannibal
    - name: murdock
    `,
        encoding: 'utf8'
      }
    })
    expect(getTeamData(client, 'input.yml')).resolves.toEqual({
      'a-team': {
        description: 'desc',
        slack: 'slack',
        members: [{name: 'hannibal'}, {name: 'murdock'}]
      }
    })
  })
})

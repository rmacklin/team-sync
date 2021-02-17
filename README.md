# team-sync

This is a GitHub action to synchronize GitHub Teams with the contents of a teams
document in an organization repository.

## Usage

1. Choose or create a repository in your organization for this action. If your
organization is already using a `.github` repository to manage GitHub files
like Issue and PR templates across the organization, that's a good choice.

2. Create a `.github/teams.yml` file in that repository with the following
   format:
   ```json
   {
     "designers": {
       "description": "The amazing design team",
       "slack": "#design-team",
       "members": [
         {
           "name": "Alice Smith",
           "github": "alicesmith"
         },
         {
           "name": "Bob Jones",
           "github": "bjonesdev"
         }
       ]
     },
     "fighters": {
       "members": [
         {
           "name": "Dave Grohl",
           "github": "dgrohl"
         },
         {
           "name": "Taylor Hawkins",
           "github": "taylorhawk1"
         }
       ]
     }
   }
   ```
   For the team sync, what's important is that the outer object maps each team
   name to an object with a `members` array of objects containing a `github`
   key. Any other fields can be included in the `members` objects (e.g. `name`,
   `email`, etc.) but `github` is the required one that declares which GitHub
   users should be part of each team.

   If you provide a `description` field alongside the `members` array, this
   description will be synced to the GitHub Team's description. Any other fields
   can be included alongside these two (e.g. Slack channel, Trello board URL,
   etc.), though they will be ignored by the action.

3. As an organization administrator, generate a [Personal Access Token] with the
   `admin:org` scope. Enable SSO for the token if necessary for your
   organization. (The `admin:org` scope is necessary to manage GitHub Teams.)
   If your repository is private, you also need to include the `repo` scope.

   [Personal Access Token]: https://github.com/settings/tokens

4. In the repository settings, create a new Secret called
   `ORG_ADMIN_ACCESS_TOKEN` to store the token. (The name of the secret is not
   important, as long you use that name to configure the `repo-token` secret
   below.)

5. Create a `.github/workflows/team_sync.yml` file like this:
   ```yml
   name: 'Team Sync'
   on:
     push:
       branches:
         - master
       paths:
         - '.github/teams.yml'

   jobs:
     synchronize-teams:
       runs-on: ubuntu-latest
       steps:
       - uses: rmacklin/team-sync@v0
         with:
           repo-token: "${{ secrets.ORG_ADMIN_ACCESS_TOKEN }}"
   ```

Now your team can create pull requests that update the `teams.yml` file
and when they are merged to `master`, the GitHub Teams in your organization
will be created/updated according to those changes!

## Additional Configuration

### `prefix-teams-with`

For large organizations, it may be more appropriate/practical to manage teams
within a subdivision of the larger organization. However, team names still have
to be unique across the whole GitHub organization. To support this, you can
specify the `prefix-teams-with` attribute in the action configuration:

`.github/workflows/team_sync.yml`:
```yml
name: 'Team Sync'
on:
  push:
    branches:
      - master
    paths:
      - '.github/teams.yml'

jobs:
  synchronize-teams:
    runs-on: ubuntu-latest
    steps:
    - uses: rmacklin/team-sync@v0
      with:
        repo-token: "${{ secrets.ORG_ADMIN_ACCESS_TOKEN }}"
        prefix-teams-with: 'foo'
```

`.github/teams.yml`:
```json
{
  "designers": {
    "description": "The amazing design team",
    "members": [
      {
        "name": "Alice Smith",
        "github": "alicesmith"
      },
      {
        "name": "Bob Jones",
        "github": "bjonesdev"
      }
    ]
  },
  "fighters": {
    "members": [
      {
        "name": "Dave Grohl",
        "github": "dgrohl"
      },
      {
        "name": "Taylor Hawkins",
        "github": "taylorhawk1"
      }
    ]
  }
}
```
This configuration would create the teams `foo designers` and `foo fighters`
(rather than `designers` and `fighters`).

### `team-data-path`

By default, the action looks for the team data in the `.github/teams.yml` file
in your repository. You can specify the `team-data-path` option to change this.
(Note that you'll also want to change the `paths` configuration specified in the
workflow definition.) For example, if you want to keep `teams.yml` in the root
of your repository, you could use:
```yml
name: 'Team Sync'
on:
  push:
    branches:
      - master
    paths:
      - 'teams.yml'

jobs:
  synchronize-teams:
    runs-on: ubuntu-latest
    steps:
    - uses: rmacklin/team-sync@v0
      with:
        repo-token: "${{ secrets.ORG_ADMIN_ACCESS_TOKEN }}"
        team-data-path: 'teams.yml'
```

### The `team_sync_ignored` property

You can add `"team_sync_ignored": true` to a team's properties to prevent that
team from being synchronized with a corresponding GitHub Team.

## Fine print

Note that if you rename a team (in a way that updates the team's computed slug),
this action will create a new team with the new name, rather than updating the
old team. This action will *not* delete any teams since doing so is very
destructive and difficult to reverse. (Even if you are using this action to
manage GitHub teams, it still permits the existence of other teams in the
organization that are managed elsewhere.) So, if you want to rename a team in a
way that changes its slug, you should rename the GitHub Team before you update
your teams document with the new name. Otherwise you'll need to manually delete
the old GitHub Team after this action creates a new GitHub Team using the new
name.

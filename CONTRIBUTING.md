# Contributing to Gulden

Thank you for helping improve Gulden. Contributions include code,
documentation, tests, translations, issue reports, and design or operational
proposals.

## Before You Start

- For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of
  opening a public issue.
- For larger changes, open an issue first so the approach can be discussed.
- Do not include passwords, tokens, private URLs, database files, financial
  data, or other secrets in issues or pull requests.

## Development

1. Create a focused branch from `main`.
2. Make the smallest change that solves the problem.
3. Add or update tests and documentation when behavior changes.
4. Run `npm test`, `npm run format:check`, and `npm run lint` as applicable.
5. Update the changelog for user-visible changes.
6. Submit a pull request explaining the behavior, testing, and any migration
   or security impact.

The repository's `AGENTS.md` contains the required local development and test
commands. Do not commit anything from the live `data/` directory.

## Developer Certificate of Origin

Gulden uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/).
Every commit in a pull request must include a `Signed-off-by` line certifying
that you have the right to submit the work under the project's license. Add it
with `git commit -s`.

By signing off, you certify the following:

> By making a contribution to this project, I certify that:
>
> 1. The contribution was created in whole or in part by me and I have the
>    right to submit it under the open source license indicated in the file; or
> 2. The contribution is based upon previous work that, to the best of my
>    knowledge, is covered under an appropriate open source license and I have
>    the right under that license to submit that work with modifications,
>    whether created in whole or in part by me, under the same open source
>    license (unless I am permitted to submit under a different license); or
> 3. I understand and agree that this project and the contribution are public
>    and that a record of the contribution, including my personal information
>    and a project-associated email address, is maintained indefinitely.

Contributions to the Gulden project are accepted under AGPL-3.0-only unless a
separate written agreement says otherwise. Contributors retain copyright in
their contributions; the DCO gives the project permission to distribute them
under the project license.

## Review Expectations

Pull requests may be reviewed for correctness, security, accessibility,
privacy, performance, compatibility, documentation, tests, and licensing.
Maintainers may request changes or decline a contribution. Acceptance is not a
promise of support, publication timing, or inclusion in a particular release.

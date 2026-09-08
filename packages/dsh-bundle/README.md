# ORYH Profile bundle

This package contributes the ORYH Host and Client rows through `cordis.patch.yml`. Compose it after `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` in `oryh-web`. Use the repository's `profile:install` script and the official `dsh --profile` launcher.

The bundle has no executable or application boot code. Its Host policy intentionally disables Agent tool execution until tenant-bound business tools are implemented. ORYH traditional operations remain available through authenticated Remote calls. This local-development dependency graph is not an npm release configuration.

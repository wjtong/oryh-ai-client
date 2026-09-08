# ORYH client implementation rules

- Build the product as external DeepSeek Harness plugins and a DSH Profile. The user explicitly requires reuse of the Harness plugin architecture; do not expand the standalone Web preview into a second application framework.
- Inspect the current public DSH packages in `/Users/wtong/git/deepseek-harness` before choosing an extension point. Reuse its Session, conversation/composer, model, approval, Slot, store, Connection and Gateway/Remote capabilities. Never import DSH private source paths into product code.
- ORYH plugins own business views, typed operations, tenant binding and credential isolation. Traditional UI actions and AI tools share operations; formal confirmation remains outside model-callable tools.
- `packages/web` publishes `@oryh/dsh-client`; it has no standalone page or HTTP server. Do not reintroduce a parallel application shell. Verify the resolved Profile, real plugin lifecycle, Remote descriptors and browser composition before claiming migration complete.
- Preserve existing user changes and test credentials. Do not put passwords, access keys or refresh tokens into source, logs, Session content or UI.
- See [plugin migration](docs/14-dsh-plugin-migration.md) for checked extension points and current migration status.

# ORYH Host plugin

Install through `@oryh/dsh-bundle` in the ORYH Profile. Requires public Cordis, Typert and Tools services. Configuration requires `developmentOnly: true`; `dataDirectory` is optional and must be absolute.

The plugin owns ORYH credentials, connection identity verification and encrypted draft persistence. It registers a browser-only `oryh` Remote namespace. Public wire types are exported through `./types`; build-generated descriptors use `./typert` and `./remote`. Errors cross Gateway as `oryh/business` with a safe message and domain code.

No method is a model tool. This development Profile installs an empty tool allowlist for each Agent and denies tool execution. Unloading removes those restrictions, stops new Remote work, aborts in-flight HTTP and drains entered requests without deleting credentials. Aborting transport does not undo a server write; expense reconciliation remains necessary.

The profile is single-user and local. Tenant-bound AI Sessions, business chat tools and shared hosted deployment are not supported. The local public-package links require the documented Harness compatibility patch. See [migration](../../docs/14-dsh-plugin-migration.md) for validation and limits.

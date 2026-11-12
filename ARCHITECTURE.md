# Architecture

The Vite-built React interface and TypeScript REST API share one origin. Node.js serves the static build and handles API requests. SQLite uses WAL mode and a transactional schema migration controlled by `user_version`. The initial persistence layer uses prepared statements and Node's built-in SQLite bindings, avoiding an OS-specific npm dependency in the release. Replace direct SQL access with a repository interface when a second backend is planned.

Setup requires a deployment-generated token. The application stores scrypt password hashes with independent salts and stores SHA-256 digests of session tokens. State-changing endpoints enforce the configured origin and JSON content type. HTTPS deployments set the Secure cookie attribute. The initial sign-in throttle is process-wide and resets after a minute.

Heimdall shows the value of a focused launcher. Homepage uses declarative service configuration and supports service widgets. Homarr combines editable boards with integrations, and Dashy offers multiple layout options. The initial Nexus workflow prioritizes browser-based setup and a small native deployment. [Heimdall](https://heimdall.site/docs/), [Homepage](https://gethomepage.dev/configs/services/), [Homarr](https://homarr.dev/docs/widgets/), [Dashy](https://dashy.to/).

## HTTP endpoints

- `GET /healthz` checks database availability.
- `GET /api/session` reports setup and session state.
- `POST /api/setup` accepts username, password and token. `POST /api/login` accepts username and password. `POST /api/logout` ends the current session.
- `GET /api/tiles` lists tiles. `POST /api/tiles` creates one. `PUT /api/tiles/{id}` updates it. `DELETE /api/tiles/{id}` removes it. Writes accept title, description, URL and category.

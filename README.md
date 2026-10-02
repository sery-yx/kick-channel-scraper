# kick-channel-scraper

Adds the most watched live Kick channels to a rustlog-kick instance. Every 15 minutes (and once when it
starts) it takes the 5000 most watched live channels on Kick and adds the ones the instance does not log yet.

## Run it with Docker

```bash
cp .env.example .env            # fill in the Kick credentials, the api key and the instance address
docker compose up -d --build
docker compose logs -f
```

The first job runs right away, so the logs show at once whether everything works:

```
started, rustlog-kick instance http://host.docker.internal:8025, schedule "*/15 * * * *"
Running job at 2026-10-02T17:00:00.000Z
added 12 new channels to logs
```

A job that fails is logged as `job failed: ...` and the next run tries again.

### Settings

They go in `.env`, compose refuses to start when one of them is missing.

| Variable | |
| --- | --- |
| `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` | credentials of a Kick app (kick.com/settings/developer), for example the one rustlog-kick uses |
| `RUSTLOG_API_KEY` | `adminAPIKey` of the rustlog-kick instance |
| `RUSTLOG_URL` | address of the instance as the container sees it |

Inside the container `127.0.0.1` is the container itself, so `RUSTLOG_URL` is one of:

- `http://host.docker.internal:8025` when rustlog-kick runs on the same server. It has to listen on all
  addresses (`0.0.0.0`, not only `127.0.0.1`) and a firewall has to let the Docker network reach the port.
- `http://rustlog-kick:8025` when rustlog-kick is a container on the same Docker network, using the name of
  its service. When it belongs to another compose project, join that project's network, see the end of
  `docker-compose.yml`.
- `https://logs.example.com` (or any other address) when it runs somewhere else.

### Everyday commands

```bash
docker compose run --rm kick-channel-scraper node script.js   # one run (the top 1000 channels), prints the result
git pull && docker compose up -d --build                      # update
docker compose down                                           # stop and remove the container
```

Stopping lets a job that is running finish first, for up to 8 seconds.

## Without Docker

```bash
npm install
npm start       # every 15 minutes, needs the same four variables in the environment
npm run once    # a single run
```

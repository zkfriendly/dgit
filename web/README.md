# dgit homepage

React + TypeScript homepage for the dgit project.

## Run locally

```sh
npm install
npm run dev
```

## Build

```sh
npm run build
```

## Deploy to Render

This repo includes a Render blueprint at `../render.yaml` for deploying the
homepage as a static site.

Manual Render settings:

- Root directory: `web`
- Runtime: `Static`
- Build command: `npm ci && npm run build`
- Publish directory: `dist`

## Docker

```sh
docker build -t dgit-home .
docker run --rm -p 8080:80 dgit-home
```

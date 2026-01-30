# Railway Deployment Fix

## Problem

Railway's Railpack auto-detection is adding `npm install --workspaces` to the build, but this repository is not a monorepo and has no workspaces.

## Solution

You need to configure Railway to use the correct build commands. Here are two options:

### Option 1: Configure in Railway Dashboard (Recommended)

1. Go to your Railway project: https://railway.app/project/1d6ae39b-3101-4a44-b070-38239b82be0a
2. Click on your service (YouMePhoto-Server)
3. Go to **Settings** tab
4. Scroll to **Build** section
5. Set **Custom Build Command**:
   ```
   npm ci --omit=dev
   ```
6. Leave **Build Command** empty or set to `echo "No build step needed"`
7. In the **Deploy** section, ensure **Start Command** is:
   ```
   sh start.sh
   ```
   or
   ```
   node index.js
   ```

### Option 2: Use Environment Variable

Add this environment variable in Railway dashboard:

```
NIXPACKS_NO_MUSL=1
NPM_CONFIG_WORKSPACES=false
```

### Option 3: Disable Railpack

If Railway allows, disable Railpack and use plain Nixpacks builder:
1. Go to **Settings** → **Build**
2. Set Builder to **Nixpacks** (not Railpack)

## Verification

After making changes, trigger a new deployment. The build should:
1. Run `npm ci --omit=dev`
2. Skip the workspace install step
3. Start with `node index.js`

## Current Configuration Files

- `nixpacks.toml` - Nixpacks configuration (may be ignored by Railpack)
- `Procfile` - Process file for start command
- `start.sh` - Startup script that handles volume mounting
- `package.json` - No workspace configuration (correct)

# Vercel Deployment Guide

Two separate Vercel projects for mainnet (Rhino single-pool) and Bepolia (discovery mode), both deployed from the same GitHub repository.

## Prerequisites

- Vercel account (sign up at vercel.com)
- GitHub repository pushed (e.g., https://github.com/camembera/your-repo)

## Deploy Project 1: Mainnet (Rhino)

1. Go to https://vercel.com/new
2. Click "Import Git Repository"
3. Select your GitHub repository
4. Configure the project:
   - **Project Name**: `staking-pools-rhino-mainnet`
   - **Framework Preset**: Vite (auto-detected)
   - **Root Directory**: `apps/staking-pools/frontend`
   - **Build Command**: Override with `cp public/config.deploy.rhino-mainnet.json public/config.json && npm run build`
   - **Output Directory**: `dist` (auto-detected)
   - **Install Command**: `npm install` (auto-detected)
5. Click "Deploy"

## Deploy Project 2: Bepolia

1. Go to https://vercel.com/new again
2. Click "Import Git Repository"
3. Select the **same** GitHub repository
4. Configure the project:
   - **Project Name**: `staking-pools-bepolia`
   - **Framework Preset**: Vite (auto-detected)
   - **Root Directory**: `apps/staking-pools/frontcp public/config.deploy.rhino-mainnet.json public/config.json && npm run buildend`
   - **Build Command**: Override with `cp public/config.deploy.bepolia.json public/config.json && npm run build`
   - **Output Directory**: `dist` (auto-detected)
   - **Install Command**: `npm install` (auto-detected)
5. Click "Deploy"

## Post-Deployment Configuration

### Production Branch (Both Projects)

By default, Vercel deploys from your default branch (usually `main` or `master`). To change:

1. Go to project settings → Git
2. Set **Production Branch** to your desired branch

### Custom Domains (Optional)

1. Go to project settings → Domains
2. Add custom domain:
   - Mainnet: `rhino.yourdomain.com` or similar
   - Bepolia: `bepolia-pools.yourdomain.com` or similar
3. Configure DNS as instructed by Vercel

## Automatic Deployments

After setup, both projects auto-deploy when you push to the production branch. Each commit triggers:
- Production deployment for the production branch
- Preview deployments for pull requests

## Manual Redeployment

To redeploy without pushing code:

1. Go to project dashboard
2. Click "Deployments" tab
3. Find the deployment you want to redeploy
4. Click "⋯" → "Redeploy"

## Verification

After deployment, check each site:
- Site loads at Vercel URL (e.g., `staking-pools-rhino-mainnet.vercel.app`)
- Config loads correctly (open browser console, check for errors)
- Network matches expected:
  - Mainnet: chainId 80094
  - Bepolia: chainId 80069
- Mode is correct:
  - Mainnet: single mode, Rhino pool visible
  - Bepolia: discovery mode, pool list loads

## Troubleshooting

**Build fails with config not found**: Verify the build command includes the full path to the deploy config file. The `cp` command must run before `npm run build`.

**Wrong config loads**: Check that the build command in project settings matches the intended deployment config file.

**Both projects deploy the same config**: Confirm each project has a different build command in settings → General → Build & Development Settings.

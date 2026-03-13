# Create GitHub Release

Create a GitHub release on the **Parcha-ai/grep-build** public repo and attach the build artifacts for download.

## Arguments: $ARGUMENTS

If arguments are provided, they are treated as additional release notes to include.

## Steps

1. **Read version** from `package.json` to determine the current version (e.g., `0.0.69`)

2. **Ensure tag and master are pushed to both remotes**:
   ```bash
   git push origin master && git push origin v{version}
   git push public master && git push public v{version}
   ```
   - If the tag doesn't exist locally: create it with `git tag v{version}` first
   - `origin` = Parcha-ai/claudette (private), `public` = Parcha-ai/grep-build (public)

3. **Verify build artifacts exist**: Look for:
   - `out/v{version}/make/zip/darwin/arm64/Grep Build-darwin-arm64-{version}.zip`
   - `out/v{version}/make/Grep Build-{version}-arm64.dmg`
   - If neither exists, tell the user to run `/build` or `/build force` first and STOP

4. **Generate release notes**: Get commits since the previous tag using:
   ```bash
   git log $(git tag --sort=-version:refname | sed -n '2p')..v{version} --oneline --no-decorate
   ```
   Format these as a markdown bullet list under a "## Changes" heading.

5. **Create the GitHub release** on grep-build:
   ```bash
   gh release create v{version} \
     "out/v{version}/make/zip/darwin/arm64/Grep Build-darwin-arm64-{version}.zip" \
     "out/v{version}/make/Grep Build-{version}-arm64.dmg" \
     --repo Parcha-ai/grep-build \
     --title "Grep Build v{version}" \
     --latest \
     --notes "$(cat <<'EOF'
   ## Changes
   {bullet list of commits}

   {any additional notes from $ARGUMENTS}

   ---
   **Download:** Grep Build for macOS (Apple Silicon) — `.zip` or `.dmg`
   EOF
   )"
   ```
   - **MUST use `--repo Parcha-ai/grep-build`** — releases go to the public repo
   - Attach both zip and dmg artifacts
   - Use `--latest` flag to mark as the latest release
   - Note: upload takes several minutes (~500MB of artifacts)

6. **Report the result**: Print the release URL (e.g., `https://github.com/Parcha-ai/grep-build/releases/tag/v{version}`)

## Important Notes

- Releases go to **Parcha-ai/grep-build** (public), NOT Parcha-ai/claudette (private)
- Git remotes: `origin` = claudette (private), `public` = grep-build (public)
- This skill does NOT build the application. Run `/build` or `/build force` first.
- This skill does NOT bump versions. The version in `package.json` is used as-is.
- Artifacts are macOS ARM64 only (Apple Silicon).
- Build output is in `out/v{version}/` (versioned directory from electron-forge).
- If a release for this version already exists, ask the user if they want to delete it first:
  ```bash
  gh release delete v{version} --repo Parcha-ai/grep-build --yes
  ```

#!/usr/bin/env bash
#
# Download a Ready application's approved files from Resumix, for
# /resumix-apply to upload (D-050):
#
#   ./fetch-apply-files.sh <application_id> <path> <filename> [<path> <filename>]...
#
# Each <path> is a `url` from mcp__resumix__get_apply_packet, and <filename>
# the `filename` beside it. Prints one absolute path per file, in order, once
# every file is down. On any failure it prints nothing on stdout, removes the
# application's folder and exits non-zero, so nothing half-fetched is ever
# uploaded.
#
# The files go in .apply-files/<application_id>/, next to this script:
# Playwright's browser_file_upload reads files only under the session's
# workspace, which is agent/. The folder is emptied first, so a file left
# from an earlier run is never uploaded by mistake, and it is gitignored.
#
# The token goes only where the MCP connection already goes. The base is
# RESUMIX_MCP_URL without its /api/mcp, each path must be a file path under
# /api/mcp/files/, redirects are not followed, and the header reaches curl on
# stdin, so the token is never in any process's arguments. Nothing here
# prints it. ./claude.sh exports both variables from .env.
#
# bash 3.2 and BSD tools: this runs on macOS's own bash.
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

UUID='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
FILE_PATH='^/api/mcp/files/(resume-pdf|application-file)/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
# A scheme, a host with no credentials, and an optional path prefix.
BASE_URL='^https?://[^/?#@[:space:]]+(/[^?#[:space:]]*)?$'

[[ $# -ge 3 && $((($# - 1) % 2)) -eq 0 ]] ||
  die "usage: ./fetch-apply-files.sh <application_id> <path> <filename> [<path> <filename>]..."

app_id="$1"
shift
[[ "$app_id" =~ $UUID ]] || die "$app_id is not an application_id. Nothing was downloaded."

dir="$here/.apply-files/$app_id"
# From here on, any failure leaves no folder behind, stale files included.
trap 'status=$?; if [[ $status -ne 0 ]]; then rm -rf "$dir"; fi' EXIT

url="${RESUMIX_MCP_URL:-}"
[[ -n "$url" && -n "${RESUMIX_MCP_TOKEN:-}" ]] ||
  die "RESUMIX_MCP_URL or RESUMIX_MCP_TOKEN is not set, so Resumix cannot be reached. Start the session with ./claude.sh."

base="${url%/}"
case "$base" in
  */api/mcp) base="${base%/api/mcp}" ;;
  *) die "RESUMIX_MCP_URL does not end in /api/mcp, so where the files are is unknown. Fix agent/.env, then start the session with ./claude.sh." ;;
esac
[[ "$base" =~ $BASE_URL ]] ||
  die "RESUMIX_MCP_URL is not an http(s) URL. Fix agent/.env, then start the session with ./claude.sh."

paths=()
names=()
while [[ $# -gt 0 ]]; do
  path="$1"
  name="$2"
  shift 2
  [[ "$path" =~ $FILE_PATH ]] ||
    die "$path is not a file path from mcp__resumix__get_apply_packet. Nothing was downloaded."
  [[ -n "$name" && "$name" != */* && "$name" != .* && "$name" != *[[:cntrl:]]* ]] ||
    die "\"$name\" is not a plain file name. Nothing was downloaded."
  # bash 3.2 has no associative arrays; a packet holds a handful of files.
  for seen in ${names[@]+"${names[@]}"}; do
    [[ "$seen" != "$name" ]] || die "\"$name\" is named twice. Nothing was downloaded."
  done
  paths+=("$path")
  names+=("$name")
done

rm -rf "$dir"
mkdir -p "$dir"

i=0
while [[ $i -lt ${#paths[@]} ]]; do
  out="$dir/${names[$i]}"
  code="$(
    printf 'Authorization: Bearer %s\n' "$RESUMIX_MCP_TOKEN" |
      curl -sS --fail --proto '=https,http' --max-redirs 0 --connect-timeout 10 --max-time 120 \
        -H @- -o "$out" -w '%{http_code}' "$base${paths[$i]}"
  )" || die "Resumix did not send ${paths[$i]} (${names[$i]}). Nothing was downloaded."
  [[ "$code" == 200 ]] ||
    die "Resumix answered $code for ${paths[$i]} (${names[$i]}). Nothing was downloaded."
  lower="$(printf '%s' "${names[$i]}" | tr '[:upper:]' '[:lower:]')"
  if [[ "$lower" == *.pdf && "$(head -c 4 "$out")" != '%PDF' ]]; then
    die "${names[$i]} is not a PDF. Nothing was downloaded."
  fi
  i=$((i + 1))
done

for name in "${names[@]}"; do
  printf '%s\n' "$dir/$name"
done

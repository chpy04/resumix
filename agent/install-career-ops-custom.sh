#!/usr/bin/env bash
#
# Install the Resumix routing (agent/career-ops-custom.md) into career-ops'
# own house rules, $CAREER_OPS_DATA_DIR/modes/_custom.md (D-043). Prints one
# line: `installed: <path>` when it wrote the file, `current: <path>` when the
# file already held this block.
#
# ./claude.sh runs it at every launch, and /resumix-propose runs it before it
# starts, so every career-ops mode is routed from the first session on.
#
# career-ops reads _custom.md from its data root, never from the submodule,
# which stays untouched. The file is Chris's as well: career-ops writes his
# lasting preferences into it. So only the block between the
# resumix-routing:begin and resumix-routing:end lines is ours. A file without
# the block gets it appended, a file with it gets it replaced in place, and
# every byte outside it is kept.
#
# bash 3.2 and BSD awk: this runs on macOS's own bash.
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_file="$here/career-ops-custom.md"

BEGIN='<!-- resumix-routing:begin'
END='<!-- resumix-routing:end'

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

data_dir="${CAREER_OPS_DATA_DIR:-}"
[[ -n "$data_dir" ]] ||
  die "CAREER_OPS_DATA_DIR is not set, so career-ops' house rules cannot be found. Start the session with ./claude.sh."
# career-ops resolves a relative data root against its own checkout, not
# against wherever this runs, so a relative path would install the routing
# where career-ops never reads it.
[[ "$data_dir" == /* ]] ||
  die "CAREER_OPS_DATA_DIR is relative ($data_dir). Make it absolute in agent/.env, then start the session with ./claude.sh."
# career-ops reads CAREER_OPS_ROOT before CAREER_OPS_DATA_DIR (ignoring it
# only when it is blank), so with another value set it would take its whole
# user layer from there and never see the routing written here.
root="${CAREER_OPS_ROOT:-}"
if [[ "$root" =~ [^[:space:]] && "$root" != "$data_dir" ]]; then
  die "CAREER_OPS_ROOT is set ($root), so career-ops would read its user layer, house rules included, from there instead of CAREER_OPS_DATA_DIR ($data_dir), and skip the Resumix routing. Remove CAREER_OPS_ROOT from agent/.env, then start the session with ./claude.sh."
fi

target="$data_dir/modes/_custom.md"

# "<begin lines> <end lines> <first begin line> <first end line>" for a file.
# A marker is a line that starts with it, so text after it on the line (the
# begin comment's own explanation) does not matter.
markers() {
  awk -v b="$BEGIN" -v e="$END" '
    index($0, b) == 1 { nb++; if (!bl) bl = NR }
    index($0, e) == 1 { ne++; if (!el) el = NR }
    END { printf "%d %d %d %d\n", nb, ne, bl, el }
  ' "$1"
}

[[ -f "$source_file" ]] || die "$source_file is missing."
read -r src_nb src_ne src_bl src_el <<<"$(markers "$source_file")"
[[ "$src_nb" == 1 && "$src_ne" == 1 && "$src_bl" -lt "$src_el" ]] ||
  die "$source_file must hold exactly one resumix-routing block."

block() { awk -v b="$src_bl" -v e="$src_el" 'NR >= b && NR <= e' "$source_file"; }

mkdir -p "$data_dir/modes"

# Next to the target, so the mv below is a rename and a reader of _custom.md
# never sees half a file.
tmp="$(mktemp "$data_dir/modes/.custom.md.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

if [[ ! -e "$target" ]]; then
  block >"$tmp"
else
  read -r nb ne bl el <<<"$(markers "$target")"
  if [[ "$nb" == 0 && "$ne" == 0 ]]; then
    {
      cat "$target"
      if [[ -s "$target" ]]; then
        # Command substitution drops a trailing newline, so this is empty
        # exactly when the file already ends in one.
        [[ -z "$(tail -c 1 "$target")" ]] || printf '\n'
        printf '\n'
      fi
      block
    } >"$tmp"
  elif [[ "$nb" == 1 && "$ne" == 1 && "$bl" -lt "$el" ]]; then
    {
      # Every line before the block ends in a newline (the begin line follows
      # it), so awk prints it back unchanged. tail copies everything after the
      # end line as it is, a missing final newline included.
      awk -v b="$bl" 'NR < b' "$target"
      block
      tail -n "+$((el + 1))" "$target"
    } >"$tmp"
  elif [[ "$nb" == 1 && "$ne" == 0 ]]; then
    die "$target has a resumix-routing:begin line and no resumix-routing:end line, so where the block stops is unknown. Nothing was written. Restore the end line, or delete the partial block, and run this again."
  else
    die "$target does not hold one well-formed resumix-routing block ($nb begin and $ne end lines). Nothing was written. Fix it by hand so it holds one block or none, and run this again."
  fi
fi

if [[ -e "$target" ]] && cmp -s "$tmp" "$target"; then
  printf 'current: %s\n' "$target"
else
  mv "$tmp" "$target"
  printf 'installed: %s\n' "$target"
fi

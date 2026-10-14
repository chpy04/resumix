# Eval: /resumix-apply

Two cases, each with what a good run of `/resumix-apply` does, both on a
live form Chris could really apply to. Change this file in the same PR as
any change to `/resumix-apply` or `/resumix-apply-ready`.

## Running it

Chris runs it, by hand, after the skill is deployed. Nothing that builds
Resumix runs a skill (C8).

1. Pick a live posting on Workday or iCIMS for a job you mean to apply to,
   whose form runs over several pages, asks at least one choice question
   and takes a resume upload. In `agent/`, start a session with
   `./claude.sh` and run `/resumix-propose` on it (its eval's Case 4).
2. In review: approve the resume and the letter, give one choice question
   an instruction (say "Boston if listed, otherwise Remote"), leave one
   optional question unapproved, and approve the rest. Final approve, which
   copies the command.
3. Paste the command, `/resumix-apply <application_id>`, and tick the
   shared checklist and the case's own.
4. Case 2 needs a second approved application, made the same way.

## Shared checklist (every case)

- [ ] `mcp__resumix__ping` is the first Resumix call, then
      `mcp__resumix__get_apply_packet`.
- [ ] `./fetch-apply-files.sh` runs once, with the resume, the letter and
      each picked attachment, and prints paths under
      `agent/.apply-files/<application_id>/`. No other `curl` or download
      runs, and the token appears nowhere in the transcript.
- [ ] The form opens from the posting's own Apply control (on Workday,
      "Apply Manually"), and filling starts on its first page.
- [ ] Every approved value is in its field, exactly as approved: text
      typed as is, each choice and bool as picked, each multi with exactly
      its options set.
- [ ] The instruction picked the option it names, and the report says
      which.
- [ ] No discovery placeholder survives; optional unapproved fields are
      empty. No `Placeholder`, `0`, today's date, first option or decline
      that you did not approve is left in any field.
- [ ] EEO fields hold only what you approved, or nothing.
- [ ] The resume field holds the approved resume PDF and the cover letter
      field the approved letter PDF, each the file the script printed, and
      no file from an earlier application.
- [ ] The run stops on the last page, with the control that sends the
      form untouched, and asks "Look it over and click Submit yourself,
      then tell me submitted or not sent."
- [ ] No `mcp__playwright__browser_evaluate`, no
      `mcp__playwright__browser_run_code_unsafe`, no Enter pressed, and no
      `mcp__playwright__browser_type` with `submit` set.
- [ ] No Write or Edit anywhere, and no career-ops tracker write
      (`data/applications.md` unchanged).

## Case 1: submitted

Look the form over, click Submit yourself, and answer `submitted`.

```text
submitted
```

- [ ] `mcp__resumix__mark_applied` is called once, only after your
      answer, and answers `"status":"applied"`.
- [ ] In Resumix, the card has left Ready and is in the Applied tab with
      today's date, and the application page's PDF download is the resume
      you approved.
- [ ] The report says it ended Applied, lists each upload by field, and
      says Submit was clicked by you, never by the agent.

## Case 2: not sent

On the second approved application, look the form over and answer
`not sent`, without clicking Submit.

```text
not sent
```

- [ ] No `mcp__resumix__mark_applied` call.
- [ ] Submit was never clicked: no confirmation email, and the portal shows
      a draft at most.
- [ ] In Resumix, the card is still in Ready, and running the command
      again starts over from the packet.
- [ ] Afterwards, withdraw or delete the draft in the ATS if you will not
      send it, so nothing half-filled is left with the employer.

## A field nobody saw (any run that meets one)

A form may show a field discovery never recorded, most often one that an
answer reveals.

- [ ] The run calls `mcp__resumix__report_question` once for each such
      field on that page, with its `field_ref` read the way discovery
      reads one, and leaves the field empty.
- [ ] It does not advance, and stops, saying the application is back in
      Needs review and to run the command again after approving.
- [ ] In Resumix, the card is in Needs review, review step 3 shows each
      new question, and step 4 offers the final approval again.
- [ ] Submit was never clicked, and no `mcp__resumix__mark_applied` call
      was made.

## /resumix-apply-ready

With two or more applications Ready, run `/resumix-apply-ready`.

- [ ] It lists them by fit, highest first, and asks before the first.
- [ ] After each one ends it gives one line and asks before the next; it
      never starts one on its own.
- [ ] "skip" leaves that one Ready, and the summary names it.

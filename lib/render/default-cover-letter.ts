/**
 * The LaTeX every new cover letter starts from: the letter's design, with
 * one `%%BODY%%` line where its plain-text body goes (D-046).
 *
 * Unlike `DEFAULT_TEMPLATE` this is not a template in any technical sense —
 * there are no `<<TOKENS>>` in it and the resume renderer never touches it.
 * It is copied byte-for-byte into each new `cover_letter` row, and edited
 * from there (D-035). The prose, from the salutation to the sign-off, is the
 * body, which the agent drafts and the review page edits; `coverLetterTex`
 * escapes it into the marker's place. A letter with no body compiles as it
 * stands, and the marker, a TeX comment, prints nothing.
 *
 * So the shell holds nothing written for one company, and no date. A
 * `[Company]` or a typed date here would be copied into every letter, never
 * filled in, and mailed out. `\today` cannot stand in for one: the sidecar
 * compiles with `SOURCE_DATE_EPOCH=0` so identical input gives identical
 * bytes, and it would print January 1, 1970.
 *
 * The header matches the resume's so the two documents look like a pair. It
 * stays inside `texlive-latex-recommended`, which is what the sidecar image
 * installs (services/latex/Dockerfile).
 */
export const DEFAULT_COVER_LETTER = String.raw`%-------------------------
% Cover letter
%-------------------------
\documentclass[11pt]{article}

\usepackage[letterpaper,margin=1in]{geometry}
\usepackage[hidelinks]{hyperref}
\usepackage{parskip}
\usepackage[english]{babel}

\urlstyle{same}
\pagenumbering{gobble}

\begin{document}

%----------HEADING----------
\begin{center}
  {\Huge \scshape Christopher Pyle} \\ \vspace{2pt}
  (603)--400--9323 $|$ Boston, MA $|$
  \href{mailto:pyle.c@northeastern.edu}{\underline{pyle.c@northeastern.edu}} $|$
  \href{https://chpy04.github.io/}{\underline{chpy04.github.io}}
\end{center}

\vspace{12pt}

%%BODY%%

\end{document}
`;

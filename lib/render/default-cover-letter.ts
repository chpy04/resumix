/**
 * The LaTeX every new cover letter starts from.
 *
 * Unlike `DEFAULT_TEMPLATE` this is not a template in any technical sense —
 * there are no `<<TOKENS>>` in it and the renderer never touches it. It is
 * a complete document that gets copied byte-for-byte into each new
 * `cover_letter` row, and edited from there (D-035). The bracketed
 * placeholders are prose for a human to overwrite, deliberately not tokens:
 * a `<<COMPANY>>` left unfilled would compile silently and be mailed out.
 *
 * The header matches the resume's so the two documents look like a pair. It
 * stays inside `texlive-latex-recommended`, which is what the sidecar image
 * installs (services/latex/Dockerfile).
 *
 * One trap worth knowing when editing this: a `[` at the start of a line
 * directly after `\\` is read as that `\\`'s optional length argument and
 * aborts the compile. Hence the address block leading with `[Company]`
 * rather than following `Hiring Team \\`.
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

[Month Day, Year]

\vspace{6pt}

[Company] \\
Hiring Team

\vspace{6pt}

Dear Hiring Team,

I am writing to apply for the [Role] position at [Company]. [One or two
sentences on why this company and this role in particular --- the specific
thing about the posting or the product that made you open this file.]

[The middle paragraph is the one worth rewriting every time. Take the single
most relevant thing on the resume and say what it has to do with what they
are hiring for: what you built, what it did, and why that is the experience
this role wants.]

[Close on what you would bring that the resume cannot show on its own, and
say plainly that you would welcome the chance to talk.]

Thank you for your time and consideration.

\vspace{12pt}

Sincerely, \\
Christopher Pyle

\end{document}
`;

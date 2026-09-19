/**
 * The default LaTeX template, derived from docs/reference/v1-resume.tex with
 * the Experience body, Projects body, and the two Technical
 * Skills / Additional Information skill-row blocks replaced by the four
 * <<TOKENS>> from docs/TEMPLATE_TOKENS.md. Everything else — preamble,
 * macros, the centered header, and Education — is preserved verbatim,
 * including the commented-out alternate header and font options, since this
 * is the user's real resume and they will keep hand-editing it.
 *
 * T5 (seeding) imports this as the content of the seeded default Template row.
 */
export const DEFAULT_TEMPLATE = String.raw`%-------------------------
% Resume in Latex
% Author : Jake Gutierrez
% Based off of: https://github.com/sb2nov/resume
% License : MIT
%------------------------
\documentclass[10pt]{extarticle}
\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\input{glyphtounicode}

%----------FONT OPTIONS----------
% sans-serif
% \usepackage[sfdefault]{FiraSans}
% \usepackage[sfdefault]{roboto}
% \usepackage[sfdefault]{noto-sans}
% \usepackage[default]{sourcesanspro}

% serif
% \usepackage{CormorantGaramond}
% \usepackage{charter}

\pagestyle{fancy}
\fancyhf{} % clear all header and footer fields
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

% Adjust margins
\setlength{\footskip}{4pt}
\addtolength{\oddsidemargin}{-0.530in}
\addtolength{\evensidemargin}{-0.375in}
\addtolength{\textwidth}{0.5in}
\addtolength{\topmargin}{-.45in}
\addtolength{\textheight}{0.5in}

\urlstyle{same}

\raggedbottom{}
\raggedright{}
\setlength{\tabcolsep}{0in}

% Sections formatting
\titleformat{\section}{
\vspace{-5pt}\scshape\raggedright\large
}{}{0em}{}[\color{black}\titlerule{} \vspace{0pt}]

% Ensure that generate pdf is machine readable/ATS parsable
\pdfgentounicode=1

%-------------------------
% Custom commands
\newcommand{\resumeSkillItem}[2]{
\item{
\textbf{#1}{: #2 \vspace{-1pt}}
}
}

\newcommand{\resumeItem}[1]{
\item{
#1 \vspace{-1pt}
}
}

\newcommand{\resumeItemWithoutTitle}[1]{
\item{
{\vspace{-1pt}}
}
}

\newcommand{\resumeSubheading}[4]{
\vspace{-1pt}\item
\begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
\textbf{#1} & #2 \\
\textit{#3} & \textit{#4} \\
\end{tabular*}\vspace{-1pt}
}

\newcommand{\resumeProjectHeading}[3]{
\vspace{-1pt}\item
\begin{tabular*}{1\linewidth}{l@{\extracolsep{\fill}}r}
\textbf{#1} $|$ \emph{#2} & #3 \\
\end{tabular*}\vspace{-1pt}
}

\newcommand{\resumeSubItem}[2]{\resumeSkillItem{#1}{#2}\vspace{-2pt}}

\renewcommand{\labelitemii}{$\circ$}

\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in,label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}\vspace{-3pt}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-1pt}}

%-------------------------------------------
%%%%%% RESUME STARTS HERE %%%%%%%%%%%%%%%%%%%%%%%%%%%%
\usepackage[a4paper,left=0.3in,right=0.3in,top=0.3in,bottom=0.2in]{geometry}
\begin{document}

%----------HEADING----------
% \begin{tabular*}{\textwidth}{l@{\extracolsep{\fill}}r}
%  \textbf{\href{http://sourabhbajaj.com/}{\Large Sourabh Bajaj}} & Email : \href{mailto:sourabh@sourabhbajaj.com}{sourabh@sourabhbajaj.com}\\
%  \href{http://sourabhbajaj.com/}{http://www.sourabhbajaj.com} & Mobile : +1-123-456-7890 \\
% \end{tabular*}

\begin{center}
 {\Huge \scshape Christopher Pyle} \\ \vspace{1pt}
  (603)--400--9323 
 $|$ Boston, MA $|$
 \href{pyle.c@northeastern.edu}{\underline{pyle.c@northeastern.edu}} $|$
 \href{https://www.linkedin.com/in/chris-pyle-neu/}{\underline{www.linkedin.com/in/chris-pyle-neu}} $|$ \newline
 \href{https://chpy04.github.io/}{\underline{chpy04.github.io}} $|$ \href{https://github.com/chpy04}{\underline{github.com/chpy04}} $|$
 Availability: May---December 2026
\end{center}

%-----------EDUCATION-----------
\section{Education}
 \resumeSubHeadingListStart{}
 \resumeSubheading{BS in Computer Science, Software concentration, Math minor}
  {Graduation: May 2027}
  {Northeastern University -- Boston, MA}
  {GPA\@: 3.97/4.00}
  \resumeItemListStart{}
    \resumeItem{\textbf{Relevant Coursework}: Object Oriented Design, Algorithms and Data, Computer Systems, Programming Languages, Intro to Databases, Accelerated Fundamentals of Computer Science 1 \& 2, Linear Algebra}
    \resumeItem{\textbf{Extracurriculars}: Northeastern Electric Racing (Head of Web Dev), Northeastern Alpine Ski Team (Treasurer), Game Theory Association (Secretary), Teaching Assistant (Fundamentals of Computer Science 1 \& 2), Outdoors Club}
  \resumeItemListEnd{}
\resumeSubHeadingListEnd{}    

 %-----------PROGRAMMING SKILLS-----------
<<IF:SKILLS_TOP>>\section{Technical Skills}
\begin{itemize}[leftmargin=0.15in, label={}]
 \item{
 <<SKILLS_TOP>>
 }
\end{itemize}<<ENDIF>>

%-----------EXPERIENCE-----------

<<IF:EXPERIENCES>>\section{Experience}
\resumeSubHeadingListStart{}
<<EXPERIENCES>>

 \resumeSubHeadingListEnd{}<<ENDIF>>
 
%-----------PROJECTS-----------
<<IF:PROJECTS>> \section{Projects}
\resumeSubHeadingListStart{}
<<PROJECTS>>
\resumeSubHeadingListEnd{}<<ENDIF>>

%---------------INTERESTS----------------------------
<<IF:SKILLS_BOTTOM>>\section{Additional Information}
\begin{itemize}
[leftmargin=0.15in, label={}]
 {\item{
 <<SKILLS_BOTTOM>>
 }}

\end{itemize}<<ENDIF>>


\end{document}`;

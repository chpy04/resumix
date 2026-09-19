-- Wrap each templated section in <<IF:TOKEN>> ... <<ENDIF>>.
--
-- Deselecting every item in a section left the template's
-- \begin{itemize} ... \end{itemize} with no \item, which is a FATAL LaTeX
-- error ("Something's wrong--perhaps a missing \item"), not a cosmetic one.
-- Tailoring a resume by turning a whole section off is normal, so the section
-- now disappears entirely -- heading included -- when it has no content.
--
-- Targeted section replacement rather than overwriting the whole template, so
-- edits made elsewhere in it (preamble, header, Education) are preserved. A
-- section whose surrounding LaTeX has been hand-edited will not match and is
-- left untouched; wrap it by hand to get the same protection.

-- SKILLS_TOP
update template
set content = replace(content, $old$\section{Technical Skills}
\begin{itemize}[leftmargin=0.15in, label={}]
 \item{
 <<SKILLS_TOP>>
 }
\end{itemize}$old$, $new$<<IF:SKILLS_TOP>>\section{Technical Skills}
\begin{itemize}[leftmargin=0.15in, label={}]
 \item{
 <<SKILLS_TOP>>
 }
\end{itemize}<<ENDIF>>$new$)
where position($old$\section{Technical Skills}
\begin{itemize}[leftmargin=0.15in, label={}]
 \item{
 <<SKILLS_TOP>>
 }
\end{itemize}$old$ in content) > 0
  -- Skip if this section is already wrapped, so the update cannot double-wrap
  -- (the unwrapped block is still a substring of the wrapped one).
  and position($guard$<<IF:SKILLS_TOP>>$guard$ in content) = 0;

-- EXPERIENCES
update template
set content = replace(content, $old$\section{Experience}
\resumeSubHeadingListStart{}
<<EXPERIENCES>>

 \resumeSubHeadingListEnd{}$old$, $new$<<IF:EXPERIENCES>>\section{Experience}
\resumeSubHeadingListStart{}
<<EXPERIENCES>>

 \resumeSubHeadingListEnd{}<<ENDIF>>$new$)
where position($old$\section{Experience}
\resumeSubHeadingListStart{}
<<EXPERIENCES>>

 \resumeSubHeadingListEnd{}$old$ in content) > 0
  -- Skip if this section is already wrapped, so the update cannot double-wrap
  -- (the unwrapped block is still a substring of the wrapped one).
  and position($guard$<<IF:EXPERIENCES>>$guard$ in content) = 0;

-- PROJECTS
update template
set content = replace(content, $old$ \section{Projects}
\resumeSubHeadingListStart{}
<<PROJECTS>>
\resumeSubHeadingListEnd{}$old$, $new$<<IF:PROJECTS>> \section{Projects}
\resumeSubHeadingListStart{}
<<PROJECTS>>
\resumeSubHeadingListEnd{}<<ENDIF>>$new$)
where position($old$ \section{Projects}
\resumeSubHeadingListStart{}
<<PROJECTS>>
\resumeSubHeadingListEnd{}$old$ in content) > 0
  -- Skip if this section is already wrapped, so the update cannot double-wrap
  -- (the unwrapped block is still a substring of the wrapped one).
  and position($guard$<<IF:PROJECTS>>$guard$ in content) = 0;

-- SKILLS_BOTTOM
update template
set content = replace(content, $old$\section{Additional Information}
\begin{itemize}
[leftmargin=0.15in, label={}]
 {\item{
 <<SKILLS_BOTTOM>>
 }}

\end{itemize}$old$, $new$<<IF:SKILLS_BOTTOM>>\section{Additional Information}
\begin{itemize}
[leftmargin=0.15in, label={}]
 {\item{
 <<SKILLS_BOTTOM>>
 }}

\end{itemize}<<ENDIF>>$new$)
where position($old$\section{Additional Information}
\begin{itemize}
[leftmargin=0.15in, label={}]
 {\item{
 <<SKILLS_BOTTOM>>
 }}

\end{itemize}$old$ in content) > 0
  -- Skip if this section is already wrapped, so the update cannot double-wrap
  -- (the unwrapped block is still a substring of the wrapped one).
  and position($guard$<<IF:SKILLS_BOTTOM>>$guard$ in content) = 0;

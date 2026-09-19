# Resumix latex compile service.
#
# Debian (not Alpine) because Alpine has no usable TeX Live packaging; we
# need real pdflatex plus the specific package set docs/reference/v1-resume.tex
# requires (extarticle/extsizes, latexsym, fullpage, titlesec, marvosym,
# color, enumitem, hyperref, fancyhdr, babel, tabularx, glyphtounicode,
# geometry). Node is installed from Debian's own repo purely to run
# server.js -- no npm install, no build step, zero dependencies.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      texlive-latex-base \
      texlive-latex-recommended \
      texlive-latex-extra \
      texlive-fonts-recommended \
      texlive-plain-generic \
      nodejs \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Non-root: LaTeX can read/write files and (absent -no-shell-escape) shell
# out via \write18. Never run this as root, and never expose this service
# directly to the public internet -- see README.md.
RUN useradd --create-home --home-dir /home/latex --uid 10001 --shell /usr/sbin/nologin latex

WORKDIR /app
COPY server.js ./
RUN chown -R latex:latex /app

USER latex

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

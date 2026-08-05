<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="utf-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="pl">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="/rss/channel/title"/></title>
        <style>
          body { max-width: 34rem; margin: 0 auto; padding: 2rem 1.5rem;
                 font-family: Georgia, serif; line-height: 1.6; color: #16181c;
                 background: #faf9f6; }
          a { color: #1b3fd1; }
          .info { border-top: 1px solid #e2e2dc; border-bottom: 1px solid #e2e2dc;
                  padding: 1rem 0; margin: 1.5rem 0; font-size: 0.95rem; }
          li { border-bottom: 1px solid #e2e2dc; padding: 1rem 0; list-style: none; }
          ul { padding: 0; }
          time { font-family: monospace; font-size: 0.75rem; color: #6b6f76; }
        </style>
      </head>
      <body>
        <h1><xsl:value-of select="/rss/channel/title"/></h1>
        <p><xsl:value-of select="/rss/channel/description"/></p>
        <div class="info">
          To jest kanał RSS. Skopiuj adres z paska przeglądarki i wklej do swojego
          czytnika, albo <a href="/blog">przejdź do notatek</a>.
        </div>
        <ul>
          <xsl:for-each select="/rss/channel/item">
            <li>
              <time><xsl:value-of select="pubDate"/></time>
              <h2 style="margin:0.3rem 0">
                <a href="{link}"><xsl:value-of select="title"/></a>
              </h2>
              <p style="margin:0"><xsl:value-of select="description"/></p>
            </li>
          </xsl:for-each>
        </ul>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
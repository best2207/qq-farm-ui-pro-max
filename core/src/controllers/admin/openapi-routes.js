const { buildOpenApiSpec, getOpenApiConfig } = require('../../services/openapi-spec');

function renderSwaggerHtml(specUrl, title) {
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${String(title || 'OpenAPI 文档')}</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      html, body { margin: 0; padding: 0; background: #0b1220; }
      #swagger-ui { max-width: 1200px; margin: 0 auto; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: ${JSON.stringify(specUrl)},
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
      });
    </script>
  </body>
</html>`;
}

function registerOpenApiRoutes({
    app,
    version,
}) {
    app.get('/openapi.json', async (req, res) => {
        try {
            const config = await getOpenApiConfig();
            if (!config.enabled) {
                return res.status(404).json({ ok: false, error: 'OpenAPI 文档已关闭' });
            }
            const spec = await buildOpenApiSpec(req, version);
            res.json(spec);
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.get('/swagger', async (req, res) => {
        try {
            const config = await getOpenApiConfig();
            if (!config.enabled) {
                return res.status(404).send('OpenAPI disabled');
            }
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(renderSwaggerHtml('/openapi.json', config.title));
        } catch (error) {
            res.status(500).send(error.message);
        }
    });
}

module.exports = {
    registerOpenApiRoutes,
};

FROM node:22-bookworm-slim

ENV NODE_ENV=production PORT=4173 HOST=0.0.0.0 REELBALANCE_ACCESS_MODE=public
WORKDIR /app
COPY --chown=node:node package.json package-lock.json LICENSE ./
COPY scripts/qloo-security/package.json scripts/qloo-security/package-lock.json /opt/qloo-security/
COPY scripts/patch-qloo-dependencies.mjs /opt/qloo-security/apply.mjs
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund \
 && npm ci --prefix /opt/qloo-security --ignore-scripts --no-audit --no-fund \
 && node /opt/qloo-security/apply.mjs /app /opt/qloo-security --update-audit-metadata \
 && rm -rf /opt/qloo-security \
 && npm cache clean --force
COPY --chown=node:node app ./app
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node release/synthetic-data.json ./release/synthetic-data.json
RUN mkdir -p /app/.cache && chown node:node /app/.cache
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const req=require('node:http').get({host:'127.0.0.1',port:process.env.PORT,path:'/api/bootstrap',timeout:4000},r=>{r.resume();process.exit(r.statusCode===200?0:1)});req.on('timeout',()=>{req.destroy();process.exit(1)});req.on('error',()=>process.exit(1))"
CMD ["node", "scripts/public-start.mjs"]

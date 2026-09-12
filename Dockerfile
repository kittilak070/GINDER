# Multi-stage lean Dockerfile for GINDER Node.js backend
# Skill 10: DevOps / CI/CD - Containerization best practices

FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5000

# Run as non-root user for security (OWASP A05)
USER node

COPY --chown=node:node --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node templates ./templates
COPY --chown=node:node static ./static
COPY --chown=node:node data ./data

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

CMD ["node", "server.js"]

# 阶段一：构建前端
FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
# 先复制包管理相关的文件，利用 Docker 缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/
COPY packages/core/package.json ./packages/core/
RUN pnpm install
# 复制所有源码并构建
COPY . .
RUN pnpm build

# 阶段二：用 Nginx 托管前端静态文件
FROM nginx:alpine
# 注意：Vite 默认输出在 apps/web/dist，请根据你实际 Vite 配置确认
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
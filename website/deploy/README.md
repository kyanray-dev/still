# Still 官网部署

目标为 `https://still.kyan.uno`，部署到用户现有的 Ubuntu 24.04 / Nginx 服务器。网站为静态文件，Three.js、脚本、样式和字体均从本站提供，无需网站后台进程。

## 目录与配置

| 路径 | 用途 |
| --- | --- |
| `/var/www/still/releases/<版本>` | 每次构建的独立版本，不在原目录覆盖文件 |
| `/var/www/still/current` | 指向当前发布版本的软链接 |
| `/var/www/still/downloads/` | 安装包和校验文件，独立于页面版本保留 |
| `/etc/nginx/sites-available/still.kyan.uno.conf` | Still 专属虚拟主机配置 |
| `/etc/nginx/sites-enabled/still.kyan.uno.conf` | 启用配置的软链接 |
| `/var/lib/letsencrypt` | 复用现有 HTTP ACME challenge 根目录 |
| `/root/site-backups/still.kyan.uno-<时间>` | 发布前的配置、软链接及验证记录 |

`still.kyan.uno.http.conf` 用于首次签证书前的 HTTP 服务；`still.kyan.uno.https.conf` 用于正式 HTTPS 服务。两个模板仅声明 `still.kyan.uno`，不使用 `default_server`，不修改其他站点。

`/downloads/` 直接映射到独立下载目录。安装包以 `application/octet-stream` 和附件方式返回；`.txt` 校验文件保留 `text/plain`，同样可下载。Nginx 默认处理文件大小、ETag、断点续传及单个字节范围请求，模板用 `max_ranges 1` 保留单区间下载。目录索引关闭，不存在的文件返回真正的 404。

HTML 和未带哈希的文件使用 `Cache-Control: no-cache`；`/assets/` 中符合 Vite 内容哈希命名的静态资源缓存一年。配置重复声明各 location 所需的安全响应头，避免 Nginx 的 `add_header` 继承规则导致其丢失。页面 CSP 仅允许本地脚本、连接和字体，支持本地 Three.js 渲染及内联样式，不允许嵌入页面。隐藏路径返回 404，ACME 路径除外。

## 发布前准备

在本地完成构建、下载包检查与页面验证后，仅上传 `website/dist/` 的站点文件，以及经过校验的安装包和 `.txt` 校验文件。不要上传源码、`.env`、`.git`、SSH 密钥或服务器配置到公开目录。

安装包使用包含版本和平台的文件名。先上传到临时文件，确认本地与服务器的 SHA-256 完全一致，再重命名为公开文件名；不要覆盖已有的同名版本包。若构建产物中包含 `downloads/`，将其内容复制到独立下载目录，页面发布目录内不需要再保留一份。

变更前记录当前软链接和专属配置（如存在），并保存其他已启用站点配置的 SHA-256。首次发布若不存在 Still 配置，记录此状态，回滚时仅移除本次新增的 Still 配置和启用链接。

## 首次发布和证书

以下命令由服务器管理员在确认上传目录、版本号和备份后执行。假设构建和两个模板已上传到 `/root/still-staging/`，其中静态文件位于 `dist/`，安装包位于 `downloads/`。

```sh
STILL_RELEASE=20261021-01
install -d -m 755 /var/www/still/releases /var/www/still/downloads /var/lib/letsencrypt
install -d -m 755 "/var/www/still/releases/$STILL_RELEASE"
cp -a /root/still-staging/dist/. "/var/www/still/releases/$STILL_RELEASE/"
# Copy only verified, uniquely versioned release files into the downloads directory.
# Preserve all previously published installation packages.
chmod -R a+rX "/var/www/still/releases/$STILL_RELEASE"
ln -s "releases/$STILL_RELEASE" /var/www/still/current-next
mv -Tf /var/www/still/current-next /var/www/still/current
install -m 644 /root/still-staging/still.kyan.uno.http.conf /etc/nginx/sites-available/still.kyan.uno.conf
ln -s /etc/nginx/sites-available/still.kyan.uno.conf /etc/nginx/sites-enabled/still.kyan.uno.conf
nginx -t && systemctl reload nginx
```

确认 `http://still.kyan.uno/` 已命中本站，并且 HTTP ACME 路径可读，再申请专属证书。DNS 当前已解析至服务器，无需变更。

```sh
certbot certonly --webroot -w /var/lib/letsencrypt --cert-name still.kyan.uno -d still.kyan.uno
install -m 644 /root/still-staging/still.kyan.uno.https.conf /etc/nginx/sites-available/still.kyan.uno.conf
nginx -t && systemctl reload nginx
```

服务器已有 `certbot.timer`，以及 `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx`。新证书复用该自动续期和续期后的 Nginx 重载流程；保留 HTTP challenge location。证书由 Certbot 管理，不复制到网站目录。可在发布后执行 `certbot renew --cert-name still.kyan.uno --dry-run` 验证续期配置。

## 发布验证

检查 HTTPS 证书的域名与有效期、HTTP 跳转、首页返回 200、所有本地静态文件成功加载、真实缺失页面返回 404、隐藏文件路径返回 404。验证下载包的完整 SHA-256 与本地一致，以及 `Content-Disposition: attachment`、文件大小、`.txt` 类型正确。用实际安装包路径检查字节范围请求：

```sh
curl --fail --head https://still.kyan.uno/
curl --fail --head -H 'Range: bytes=0-1023' https://still.kyan.uno/downloads/ACTUAL-VERSIONED-INSTALLER.dmg
```

第二条命令应返回 `206 Partial Content`，并有正确的 `Content-Range`。将示例文件名替换为本次实际文件名。完成桌面和手机视口的页面检查及下载点击验证后，核对其他站点配置的哈希仍与发布前一致。

## 后续更新与回滚

后续更新先创建新的 `releases/<版本>` 并完成文件校验，再通过 `current-next` 和 `mv -Tf` 原子切换 `current`。单纯更新静态页面无需重新加载 Nginx；新增安装包先完整上传并校验，再发布引用它的页面。保留上一版页面与安装包，以便恢复。

更新失败时，把 `current` 原子切回发布前记录的版本；若改过 Nginx 配置，一并恢复备份中的 Still 配置，执行 `nginx -t && systemctl reload nginx`。首次发布若需撤销，只移除本次新增的 Still 启用链接，恢复原配置存在状态，再验证并 reload；保留版本目录、下载包和证书供排查或恢复。不要删除其他站点配置、共享 ACME 目录或 Certbot 的现有账户。

## HTTPS 就绪检查

Nginx reload 是异步操作。切换 HTTPS 后使用带正常证书校验的有界重试，避免旧 worker 仍在接收连接时误判失败。

```sh
curl --fail --retry 10 --retry-all-errors --retry-delay 1 --retry-max-time 15 \
  --resolve still.kyan.uno:443:127.0.0.1 https://still.kyan.uno/ -o /dev/null
```

重试耗尽再执行回滚；不要关闭证书或主机名验证。

@echo off
::后续命令使用的是：UTF-8编码
chcp 65001
:: for /F will launch a new instance of cmd so we create a guard to prevent an infnite loop
if not defined FNM_AUTORUN_GUARD (
	set "FNM_AUTORUN_GUARD=AutorunGuard"
	FOR /f "tokens=*" %%z IN ('fnm env --use-on-cd') DO CALL %%z
)
hexo g && hexo d && git add . && git commit -m "常规文章更新" && git push origin main
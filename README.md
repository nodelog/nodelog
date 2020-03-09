###  下载代码
- git-https
  - ```shell
    git clone https://gitee.com/jiangzixin720/nodelog.git
    ```
- git-ssh
  - ```shell
    git clone git@gitee.com:jiangzixin720/nodelog.git
    ```
- svn
  - ```shell
    svn co svn://gitee.com/jiangzixin720/nodelog
    ```
- svn-ssh
  - ```shell
    svn co svn+ssh://gitee.com/jiangzixin720/nodelog
    ```
- 源码地址
  
  - https://gitee.com/jiangzixin720/nodelog
- zip离线下载
  
  - https://gitee.com/jiangzixin720/nodelog/repository/archive/master.zip

### 安装nodejs
- 系统安装nodejs
  - ```shell
    sudo apt-get install nodejs
    ```
- 系统安装npm  
  - ```shell
    # 默认安装nodejs自动安装该模块，如果没有安装，则执行下面命令安装
    sudo apt-get install npm
    ```
- 全局安装cnpm
  - ```shell
    # 淘宝cnpm镜像代替默认npm来快速安装node模块
    npm install -g cnpm --registry=https://registry.npm.taobao.org
    ```
- 全局安装pm2
  - ```shell
    # 使用负载均衡管理node进程的启动、停止和重启等
    cnpm install -g pm2
    ```
- 项目中安装依赖包
  - ```shell
    # 假如项目根目录是 /data/www/nodelog
    cd /data/www/nodelog
    cnpm install
    ```

### 安装mongodb

- windows：https://nodelog.cn/content/detail?id=53eedd48598efda003c6d0bd&view=contentDetail
- linux：https://nodelog.cn/content/detail?id=5439cdae19d713190955ceb0&view=contentDetail

### 启动mongodb

  - ```shell
    # 后台运行并自定义db和log目录
    mongod --fork --dbpath=/usr/local/mongodb/data --logpath /usr/local/mongodb/log/mongodb.log --logappend
    ```

### 修改配置

  - ```js
    # settings.bak.js文件重命名为：settings.js
    module.exports = {
        port: 3000, //web端口
        cookieSecret: 'cookieSecret', //cookie名称
        dbUrl: 'mongodb://zhangsan:123456@127.0.0.1:27017/nodelog', //mongodb://用户名:密码@数据库ip:端口号/数据库名
        email: {
            host: 'smtp服务器',
            port: 465,//smtp端口，非加密：25，加密：465
            secure: true,//是否加密，
            user: '发送邮箱用户名',
            pass: '发送邮箱密码'
        }
    };
    
    ```

### 启动应用

  - ```shell
    # bin/www 启动文件，-i node负载进程数，max = cpu核数
    pm2  start bin/www -i max
    
    # 其他pm2相关命令
    pm2 list               # 显示所有进程状态
    pm2 monit              # 监视所有进程
    pm2 logs               # 显示所有进程日志
    pm2 stop all           # 停止所有进程
    pm2 restart all        # 重启所有进程
    pm2 reload all         # 0 秒停机重载进程 (用于 NETWORKED 进程)
    pm2 stop 0             # 停止指定的进程
    pm2 restart 0          # 重启指定的进程
    pm2 delete 0           # 杀死指定的进程
    pm2 delete all         # 杀死全部进程
    ```
### nginx反向代理
  - ```shell
    server {
        listen      80;
        server_name nodelog.cn;
        index index.html index.htm index.ejs;
        root /data/www/nodelog;	
        
        #https 加密协议，ssl证书
        # listen      443;
        # ssl_certificate   cert/nodelog.cn.pem;
        # ssl_certificate_key  cert/nodelog.cn.key;
        # ssl_session_timeout 5m;
        # ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE:ECDH:AES:HIGH:!NULL:!aNULL:!MD5:!ADH:!RC4;
        # ssl_protocols TLSv1 TLSv1.1 TLSv1.2;
        # ssl_prefer_server_ciphers on;
        
        # 静态资源文件根目录指定，不设置则404 *****五颗星重要
        location ~ ^/(images/|js/|css/|font/|fonts/) {
          root /data/www/nodelog/public;
          access_log off;
          expires max;
        }
        #图片缓存
        location ~ .*\.(gif|jpg|jpeg|png|bmp|swf)$
        {
                expires 30d;
        }
        #js和css缓存
        location ~ .*\.(js|css)?$
        {
                expires 1h;
        }
        #反向代理到本地node项目3000端口 *****五颗星重要
    location / {
                proxy_pass http://127.0.0.1:3000;
    
        }
        #拒绝代码库文件响应
        location ~ /\.(ht|svn|git) {
                deny all;
        }
        #访问日志
        access_log  /data/logs/nginx/access/nodelog.log;
    }
    ```

### 访问

- 本地：http://127.0.0.1:3000
- http：http://nodelog.cn
- htts：https://nodelog.cn


 **1. 下载代码** 

` git clone git@gitee.com:nodelog/nodelog.git`

 **2. 安装nodejs以及相关** 
- 安装nodejs，命令：

`sudo apt-get install nodejs`

- 安装npm，默认安装nodejs自动安装该模块，如果没有，则执行下面命令安装：

`sudo apt-get install npm`

- 安装cnpm（淘宝npm镜像代替默认npm来快速安装node模块），命令：

`npm install -g cnpm --registry=https://registry.npm.taobao.org`

- 安装项目中所有node模块（自动生成node_modules目录）,在项目根目录（项目模块依赖配置文件package.json所在目录）下执行命令：

`cnpm install`

- 安装pm2，PM2是带有负载均衡功能的 Node 应用的进程管理器，启动、停止、重启本系统用这个工具就够了：

`cnpm install -g pm2`


 **3. 安装mongodb** ，具体方法百度 or google


 **4. 启动mongodb** ,指定db目录和log目录

`mongod --fork --dbpath=/usr/local/mongodb/data --logpath /usr/local/mongodb/log/mongodb.log --logappend` 


5. 修改系统配置
- 复制settings.bak.js文件重命名为：settings.js
- 修改配置参数：

```
module.exports = {
    port: 3000,                                                                             //端口
    cookieSecret: 'cookieSecret',                                                           //cookie名称
    dbUrl: 'mongodb://用户名:密码@数据库ip:端口号（默认27017没有修改的话可省略）/数据库名',      //mongodb数据库链接，如下：
//  dbUrl: 'mongodb://zhangsan:123456@127.0.0.1/ondelog',
    //发送邮箱配置
    email: {
        host: 'smtp服务器',
        port: 465,//smtp端口，非加密：25，加密：465
        secure: true,//是否加密，
        user: '发送邮箱用户名',
        pass: '发送邮箱密码'
    }
};

```


 **6. 启动应用** ，启动文件为：bin/www，-i max参数为：根据有效CPU数目启动最大进程数目来做负载

`pm2  start bin/www -i max`




 **7. 这里是列表文本官方文档** 

[ NODELOG安装说明](https://nodelog.cn/content/detail?id=5ba8c627d40a18055852fb47&view=contentDetail)




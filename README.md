nodelog 解点日志使用说明
=======
1、下载代码<br>
2、安装nodejs以及相关<br>
    sudo apt-get install nodejs<br>
    sudo apt-get install npm<br>
    npm --registry=http://r.cnpmjs.org install  forever -g<br>
    npm --registry=http://r.cnpmjs.org install  supervisor -g<br>
    npm --registry=http://r.cnpmjs.org install  express-generator@4 -g<br>
3、安装mongodb<br>
4、启动mongodb<br>
 mongod --fork --dbpath=/usr/local/mongodb/data --logpath /usr/local/mongodb/log/mongodb.log --logappend</br>
5、运行nodelog<br>

supervisor app.js或者forever start app.js<br>

参数配置文件：settings.bak.js，正式使用重命名为settings.js，并修改其中参数值，特别是mongodb用户名、密码和数据库名


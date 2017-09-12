//参数设置
module.exports = {
    port: 3000,                                                                             //端口
    cookieSecret: 'cookieSecret',                                                        //cookie
    dbUrl: 'mongodb://mongodbUser:mongodbPassword@localhost/ctit',                    //mongodb数据库链接

    //发送邮箱配置
    email: {
        host: 'smtp服务器',
        port: 465,//smtp端口，非加密：25，加密：465
        secure: true,//是否加密，
        user: '发送邮箱用户名',
        pass: '发送邮箱密码'
    }
};

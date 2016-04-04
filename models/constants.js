/**
 * 常量类
 * Created by Jack.Wang on 14-7-24.
 */

//用户状态
exports.USER_ENABLE_STATUS=0;//正常
exports.USER_UNABLE_STATUS=1;//禁用
exports.USER_DELETE_STATUS=2;//删除

//分类状态
exports.CATEGORY_ENABLE_STATUS=0;//正常
exports.CATEGORY_UNABLE_STATUS=1;//禁用

//评论状态
exports.COMMENT_ENABLE_STATUS=0;//正常
exports.COMMENT_UNABLE_STATUS=1;//禁用

//文章状态
exports.CONTENT_ENABLE_STATUS=0;//正常 分享
exports.CONTENT_UNABLE_STATUS=1;//禁用
exports.CONTENT_SELF_STATUS=2;//私有
exports.content_type_original = 0;//原创
exports.CONTENT_TYPE_TRANSFER = 1;//转载

//公告状态
exports.LOG_ENABLE_STATUS=0;//正常
exports.LOG_UNABLE_STATUS=1;//禁用

//分页大小，每页显示9条数据
exports.PER_PAGE_COUNT = 9;
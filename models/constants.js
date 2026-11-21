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

// 文档类型（Blog + Wiki 一体化）：与 contentType（html/markdown，正文格式）正交，勿复用。
// 历史文档无此字段，读取判定一律用 {$ne:'wiki'} 兼容（同 draft 的 {$ne:true} 教训）。
exports.DOC_TYPE_BLOG = 'blog';
exports.DOC_TYPE_WIKI = 'wiki';

// 空间可见性（字段 MVP 预留，UI/权限增强阶段启用）
exports.SPACE_VISIBILITY_PUBLIC = 'public';
exports.SPACE_VISIBILITY_PRIVATE = 'private';

//公告状态
exports.LOG_ENABLE_STATUS=0;//正常
exports.LOG_UNABLE_STATUS=1;//禁用

//分页大小，每页显示9条数据
exports.PER_PAGE_COUNT = 9;
// TODO: DB 연결 후 이 배열 전체 삭제하고 RECIPE_COMMENTS 테이블 쿼리로 교체할 것
// DDL: CREATE TABLE "RECIPE_COMMENTS" (comment_id BIGSERIAL, recipe_id BIGINT NOT NULL, user_id BIGINT NOT NULL,
//      content TEXT NOT NULL, like_count INT NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NULL)
const MOCK_COMMENTS = [
  {
    comment_id: 1,
    recipe_id: 1,
    user_id: 1,
    user_nickname: '막걸리덕후',
    content: '복숭아 막걸리 정말 기대됩니다!',
    like_count: 5,
    created_at: '2026-04-30T10:00:00.000Z',
    updated_at: null,
  },
  {
    comment_id: 2,
    recipe_id: 1,
    user_id: 2,
    user_nickname: '전통주마니아',
    content: '여름에 딱이겠네요. 빨리 출시됐으면!',
    like_count: 2,
    created_at: '2026-04-30T11:00:00.000Z',
    updated_at: null,
  },
];

// TODO: DB 연결 후 RECIPE_COMMENT_LIKES 테이블 SELECT 쿼리로 교체할 것
// DDL: CREATE TABLE "RECIPE_COMMENT_LIKES" (
//   "like_id"    BIGSERIAL  NOT NULL,
//   "comment_id" BIGINT     NOT NULL,
//   "user_id"    BIGINT     NOT NULL,
//   "created_at" TIMESTAMP  NOT NULL,
//   CONSTRAINT PK_RECIPE_COMMENT_LIKES PRIMARY KEY ("like_id"),
//   CONSTRAINT UQ_RECIPE_COMMENT_LIKES UNIQUE ("comment_id", "user_id")
// );
const MOCK_COMMENT_LIKES = [];

let nextCommentId = 3;

// TODO: DB 연결 후 USERS 테이블 SELECT 쿼리로 닉네임 조회하도록 교체할 것
// JWT 페이로드에 nickname이 없어서 임시로 user_id → 닉네임 고정 매핑 사용
const MOCK_USER_NICKNAMES = { 1: '막걸리덕후', 2: '전통주마니아' };

// 댓글 목록 조회 (GET /api/recipes/:recipeId/comments)
// - page, size로 페이지네이션 (page는 0부터 시작)
// - userId가 null이면 is_liked는 항상 false (비로그인 사용자)
// TODO: DB 연결 후 RECIPE_COMMENTS JOIN USERS + RECIPE_COMMENT_LIKES LEFT JOIN 쿼리로 교체
const getCommentsByRecipeId = async (recipeId, page, size, userId) => {
  const filtered = MOCK_COMMENTS.filter((c) => c.recipe_id === recipeId);

  const totalElements = filtered.length;
  const totalPages = Math.ceil(totalElements / size) || 1;
  const start = page * size;

  const items = filtered.slice(start, start + size).map((c) => ({
    comment_id: c.comment_id,
    user_nickname: c.user_nickname,
    content: c.content,
    like_count: c.like_count,
    is_liked: userId !== null && MOCK_COMMENT_LIKES.some(
      (l) => l.comment_id === c.comment_id && l.user_id === userId
    ),
    created_at: c.created_at,
    updated_at: c.updated_at,
  }));

  return { comments: items, totalElements, totalPages, currentPage: page };
};

// 댓글 작성 (POST /api/recipes/:recipeId/comments)
// TODO: DB 연결 후 RECIPE_COMMENTS INSERT 쿼리로 교체 (comment_id는 BIGSERIAL로 자동 생성)
const createComment = async (recipeId, content, user) => {
  const nickname = MOCK_USER_NICKNAMES[user.id] || `user_${user.id}`;
  const comment = {
    comment_id: nextCommentId++,
    recipe_id: recipeId,
    user_id: user.id,
    user_nickname: nickname,
    content,
    like_count: 0,
    created_at: new Date().toISOString(),
    updated_at: null,
  };
  MOCK_COMMENTS.push(comment);
  return {
    comment_id: comment.comment_id,
    user_nickname: comment.user_nickname,
    content: comment.content,
    like_count: comment.like_count,
    created_at: comment.created_at,
    updated_at: comment.updated_at,
  };
};

// 댓글 수정 (PUT /api/recipes/:recipeId/comments/:commentId)
// - 작성자 본인만 수정 가능 (호출 전에 컨트롤러에서 userId 검증)
// - 성공 시 updated_at 갱신
// TODO: DB 연결 후 RECIPE_COMMENTS UPDATE 쿼리로 교체
const updateComment = async (commentId, content) => {
  const comment = MOCK_COMMENTS.find((c) => c.comment_id === commentId);
  comment.content = content;
  comment.updated_at = new Date().toISOString();
  return {
    comment_id: comment.comment_id,
    user_nickname: comment.user_nickname,
    content: comment.content,
    like_count: comment.like_count,
    created_at: comment.created_at,
    updated_at: comment.updated_at,
  };
};

// 댓글 삭제 (DELETE /api/recipes/:recipeId/comments/:commentId)
// - 작성자 본인만 삭제 가능 (호출 전에 컨트롤러에서 userId 검증)
// TODO: DB 연결 후 RECIPE_COMMENTS DELETE 쿼리로 교체
const deleteComment = async (commentId) => {
  const idx = MOCK_COMMENTS.findIndex((c) => c.comment_id === commentId);
  MOCK_COMMENTS.splice(idx, 1);
};

// 댓글 단건 조회 (권한 검증용 내부 헬퍼)
// TODO: DB 연결 후 RECIPE_COMMENTS SELECT WHERE comment_id 쿼리로 교체
const getCommentById = (commentId) =>
  MOCK_COMMENTS.find((c) => c.comment_id === commentId) || null;

// 댓글 좋아요 등록 (POST /api/recipes/:recipeId/comments/:commentId/likes)
// - UNIQUE 제약: 동일 사용자가 같은 댓글에 중복 좋아요 불가
// - 성공 시 RECIPE_COMMENTS.like_count +1
// TODO: DB 연결 후 RECIPE_COMMENT_LIKES INSERT + RECIPE_COMMENTS UPDATE 쿼리로 교체
const likeComment = async (commentId, userId) => {
  const comment = MOCK_COMMENTS.find((c) => c.comment_id === commentId);
  if (!comment) return { error: 'not_found' };

  const alreadyLiked = MOCK_COMMENT_LIKES.some(
    (l) => l.comment_id === commentId && l.user_id === userId
  );
  if (alreadyLiked) return { error: 'duplicate' };

  MOCK_COMMENT_LIKES.push({ comment_id: commentId, user_id: userId, created_at: new Date().toISOString() });
  comment.like_count += 1;
  return { like_count: comment.like_count };
};

// 댓글 좋아요 취소 (DELETE /api/recipes/:recipeId/comments/:commentId/likes)
// - 좋아요를 누른 적 없는 경우 404
// - 성공 시 RECIPE_COMMENTS.like_count -1 (최솟값 0 보장)
// TODO: DB 연결 후 RECIPE_COMMENT_LIKES DELETE + RECIPE_COMMENTS UPDATE 쿼리로 교체
const unlikeComment = async (commentId, userId) => {
  const comment = MOCK_COMMENTS.find((c) => c.comment_id === commentId);
  if (!comment) return { error: 'not_found' };

  const idx = MOCK_COMMENT_LIKES.findIndex(
    (l) => l.comment_id === commentId && l.user_id === userId
  );
  if (idx === -1) return { error: 'not_liked' };

  MOCK_COMMENT_LIKES.splice(idx, 1);
  comment.like_count = Math.max(0, comment.like_count - 1);
  return { like_count: comment.like_count };
};

module.exports = { getCommentsByRecipeId, createComment, updateComment, deleteComment, getCommentById, likeComment, unlikeComment };

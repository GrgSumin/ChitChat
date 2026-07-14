import { Prisma } from "../generated/prisma/client";

export function getUserDataSelect(loggedInUserId: string) {
  return {
    id: true,
    username: true,
    displayName: true,
    avatarUrl: true,
    bio: true,
    createdAt: true,
    followers: {
      where: {
        followerId: loggedInUserId,
      },
      select: {
        followerId: true,
      },
    },
    _count: {
      select: {
        posts: true,
        followers: true,
      },
    },
  } satisfies Prisma.UserSelect;
}

export type UserData = Prisma.UserGetPayload<{
  select: ReturnType<typeof getUserDataSelect>;
}>;

export function getPostDataInclude(loggedInUserId: string) {
  return {
    user: {
      select: getUserDataSelect(loggedInUserId),
    },
    attachments: true,
    likes: {
      where: {
        userId: loggedInUserId,
      },
      select: {
        userId: true,
      },
    },
    bookmarks: {
      where: {
        userId: loggedInUserId,
      },
      select: {
        userId: true,
      },
    },
    _count: {
      select: {
        likes: true,
        comments: true,
      },
    },
  } satisfies Prisma.PostInclude;
}

export type PostData = Prisma.PostGetPayload<{
  include: ReturnType<typeof getPostDataInclude>;
}>;

export interface PostsPage {
  posts: PostData[];
  nextCursor: string | null;
}

export function getCommentDataInclude(loggedInUserId: string) {
  return {
    user: {
      select: getUserDataSelect(loggedInUserId),
    },
  } satisfies Prisma.CommentsInclude;
}

export type CommentData = Prisma.CommentsGetPayload<{
  include: ReturnType<typeof getCommentDataInclude>;
}>;

export interface CommentsPage {
  comments: CommentData[];
  previousCursor: string | null;
}

export const notificationInclude = {
  issuer: {
    select: {
      username: true,
      displayName: true,
      avatarUrl: true,
    },
  },

  post: {
    select: {
      content: true,
    },
  },
} satisfies Prisma.NotificationInclude;

export type NotificationData = Prisma.NotificationGetPayload<{
  include: typeof notificationInclude;
}>;

export interface NotificationPage {
  notifications: NotificationData[];
  nextCursor: string | null;
}
export interface FollowerInfo {
  followers: number;
  isFollowedByUser: boolean;
}

export interface LikeInfo {
  like: number;
  isLikedByUser: boolean;
}

export interface BookMarkInfo {
  isBookMarkedByUser: boolean;
}

export interface NotificationCountInfo {
  unreadCount: number;
}

export const chatUserSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;
export type ChatUser = Prisma.UserGetPayload<{ select: typeof chatUserSelect }>;

export const messageInclude = {
  sender: {
    select: chatUserSelect,
  },
  attachments: true,
} satisfies Prisma.MessageInclude;

export type MessageData = Prisma.MessageGetPayload<{
  include: typeof messageInclude;
}>;

export interface MessagesPage {
  messages: MessageData[];
  previousCursor: string | null;
}

export const chatInclude = {
  participants: {
    include: {
      user: {
        select: chatUserSelect,
      },
    },
  },
  messages: {
    orderBy: { createdAt: "desc" },
    take: 1,
    include: messageInclude,
  },
} satisfies Prisma.ChatInclude;

export type ChatData = Prisma.ChatGetPayload<{
  include: typeof chatInclude;
}> & { unreadCount: number };

export interface ChatsPage {
  chats: ChatData[];
  nextCursor: string | null;
}

export interface MessagesCountInfo {
  unreadCount: number;
}

export interface TypingInfo {
  chatId: string;
  userId: string;
  displayName: string;
  isTyping: boolean;
}

export interface ClientToServerEvents {
  "chat:create": (
    data: { userIds: string[]; name?: string },
    callback: (res: { chat?: ChatData; error?: string }) => void,
  ) => void;
  "message:send": (
    data: { chatId: string; content: string; attachmentIds: string[] },
    callback: (res: { error?: string }) => void,
  ) => void;
  "chat:read": (data: { chatId: string }) => void;
  "typing:start": (data: { chatId: string }) => void;
  "typing:stop": (data: { chatId: string }) => void;
}
export interface ServerToClientEvents {
  "chat:new": (chat: ChatData) => void;
  "message:new": (message: MessageData) => void;
  typing: (data: TypingInfo) => void;
  "presence:state": (onlineUserIds: string[]) => void;
  "presence:online": (data: { userId: string }) => void;
  "presence:offline": (data: { userId: string }) => void;
}

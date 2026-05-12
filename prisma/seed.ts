import { Prisma, PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const fateCards: Prisma.FateCardCreateManyInput[] = [
  {
    question_text: '你发现对方隐藏了一段会伤害你信任的视频，但那段视频也可能解释对方最深的恐惧。你会先要求真相，还是先保护关系的完整感？',
    option_a: '立即要求对方交出完整真相，即使关系可能当场崩塌。',
    option_b: '暂时不追问，继续观察对方是否会主动交出钥匙。',
  },
  {
    question_text: '系统只允许你保留一条匿名留言：一条能让对方留下，一条能让自己体面离开。你会把最后的话留给谁？',
    option_a: '留给对方，让对方带着答案继续走。',
    option_b: '留给自己，确保自己不会在沉默里被吞没。',
  },
  {
    question_text: '你们的连接即将升级，但升级会公开你曾经最不愿被看见的一次失败。你是否愿意用暴露换取更深连接？',
    option_a: '公开失败，赌对方能接住真实的自己。',
    option_b: '拒绝升级，保留尊严但失去这段连接的深度。',
  },
  {
    question_text: '对方在第 15 天仍未向你确认关系方向，系统提示你可以将其转为 WATCHER。你会按下这颗按钮吗？',
    option_a: '按下，将对方推出碰撞世界，保护自己的 30 天。',
    option_b: '不按，给对方最后一次主动靠近的机会。',
  },
  {
    question_text: '你知道对方正在同时靠近另一个人，但系统没有禁止多重羁绊。你会追问，还是让博弈自然淘汰？',
    option_a: '追问并要求唯一性，哪怕显得占有欲过强。',
    option_b: '保持沉默，把选择权交给最终审判。',
  },
  {
    question_text: '你可以花掉仅剩的一点 fire_points 查看一次对方的模糊影像，但这会让你之后失去一次主动匹配机会。你会看吗？',
    option_a: '看，至少确认自己是否仍愿意投入。',
    option_b: '不看，把稀缺资源留给新的可能性。',
  },
  {
    question_text: '对方请求你删除一段你珍视的聊天记录，因为那段记录让对方感到羞耻。你会尊重请求还是保留证据？',
    option_a: '删除，让对方相信自己不是被审判的对象。',
    option_b: '保留，因为记忆也是自我保护的一部分。',
  },
  {
    question_text: '你收到系统提示：只要你在今晚 FIRE 模式里发出一句足够残酷的真话，就能提前揭开对方滤镜。你会这么做吗？',
    option_a: '说出残酷真话，提前结束不确定性。',
    option_b: '克制冲动，让滤镜按时间自然脱落。',
  },
  {
    question_text: '第 30 天审判前，对方希望你先表态。如果你先交出钥匙，对方可以选择保留防御。你会先交吗？',
    option_a: '先交出钥匙，把主动权完全交给对方。',
    option_b: '拒绝先交，要求双方同步进入最终选择。',
  },
  {
    question_text: '如果最终失败，你可以选择生成一张体面的星尘车票，或删除所有痕迹让这段关系像没发生过。你会保留遗物吗？',
    option_a: '生成车票，承认这 30 天真实存在过。',
    option_b: '删除痕迹，让失败不再拥有名字。',
  },
];

async function main(): Promise<void> {
  await prisma.fateCard.createMany({
    data: fateCards,
    skipDuplicates: true,
  });

  const count = await prisma.fateCard.count();
  if (count < fateCards.length) {
    throw new Error(`FateCard seed integrity check failed: expected at least ${fateCards.length}, got ${count}.`);
  }

  console.info(`Seed completed. FateCard rows available: ${count}.`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Shared pure text heuristics used by both the renderer (continuous-mode gate)
 * and the main process (prompt building). Kept in shared/ so neither side
 * imports across the electron/renderer project boundary.
 */

const QUESTION_WORDS =
  /(什么|怎么|为什么|为何|如何|是否|能不能|可不可以|可以吗|要不要|有没有|请问|说说|谈谈|介绍|讲讲|请你|你觉得|你认为|如何看|多少|哪些|哪个|吗|呢|\?|？|\bwhat\b|\bhow\b|\bwhy\b|\bwhen\b|\bwhere\b|\bwhich\b|\bcould you\b|\bcan you\b|\bwould you\b|\btell me\b|\bexplain\b|\bdescribe\b)/i;

/**
 * Does the other party's line look like a question worth auto-answering
 * (continuous-mode gate, to avoid answering every fragment)?
 */
export function isLikelyQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  if (/[?？]$/.test(t)) return true;
  if (QUESTION_WORDS.test(t)) return true;
  // long utterances often carry an implicit ask even without a marker
  return t.length >= 40;
}

// ---------- question-type hint (prompt v2) ----------

export type QuestionKind = 'behavioral' | 'technical' | 'smalltalk' | 'other';

/** greetings / audio checks / pleasantries — a one-liner reply is enough */
const SMALLTALK =
  /(你好|您好|哈喽|嗨|早上好|下午好|晚上好|听得到|听得清|能听到|声音清楚|信号|网络(好|不太好|卡)|麦克风|不好意思|久等|辛苦|谢谢你?的?时间|方便(开始|吗)|准备好了?吗|开始了?吗|\bhello\b|\bhi\b|\bgood (morning|afternoon|evening)\b|can you hear me|nice to meet)/i;

/** experience / motivation / self-intro — answer with STAR from the resume */
const BEHAVIORAL =
  /(自我介绍|介绍(一下)?(你|您)?自己|(为什么|为啥).{0,12}(离职|离开|跳槽|换工作|来我们|选我们|选择我们|加入|应聘|投递)|离职原因|优点|缺点|优劣势|印象(最|比较)深|最有成就|最(大|难)的(挑战|困难|失败)|挑战.*(怎么|如何)|失败的?经历|和?同事.*(冲突|分歧|矛盾)|团队(合作|协作|冲突)|怎么(带|管理)团队|压力.*(怎么|如何)|加班怎么看|职业(规划|发展)|未来.*规划|期望薪|薪资(要求|期望)|还有什么(问题|想问)|tell me about yourself|why (do|did|would) you (want|leave|join|choose)|(greatest|biggest) (strength|weakness|challenge|failure)|a time (when|you)|conflict with|career (plan|goal)|salary expectation)/i;

/** knowledge / design / algorithm — answer with idea → key points → complexity */
const TECHNICAL =
  /(算法|复杂度|数据结构|链表|二叉树|哈希|排序|动态规划|手写|(写|实现)(一个|一段|个)?(代码|函数)|架构|系统设计|设计一个|(什么|啥)是|原理|底层|源码|实现(机制|原理)|区别|对比|优缺点分析|优化|调优|性能|并发|多线程|线程|进程|协程|锁|死锁|内存(泄漏|管理|模型)|垃圾回收|索引|事务|隔离级别|分布式|一致性|高可用|缓存|消息队列|限流|http|https|tcp|udp|dns|rest|grpc|sql|nosql|redis|kafka|mysql|mongo|docker|k8s|kubernetes|linux|shell|git|python|java(script)?|typescript|golang|rust|c\+\+|react|vue|node|spring|django|机器学习|深度学习|神经网络|大模型|transformer|微调|推理|训练|prompt|rag|agent|embedding|how (does|do|would) .+ work|difference between|implement|time complexity|design (a|an)|explain how)/i;

/**
 * Rough interview-question triage. The result only feeds a one-line hint in
 * the user message (zero latency, advisory — the model may override it), so
 * precision matters more than recall: unknown stays 'other' (no hint).
 * Order: smalltalk (short pleasantries) → behavioral → technical.
 */
export function classifyQuestion(text: string): QuestionKind {
  const t = text.trim();
  if (!t) return 'other';
  if (t.length <= 30 && SMALLTALK.test(t) && !TECHNICAL.test(t)) return 'smalltalk';
  if (BEHAVIORAL.test(t)) return 'behavioral';
  if (TECHNICAL.test(t)) return 'technical';
  return 'other';
}

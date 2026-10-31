'use strict';
window.BabyData = {
  date:'2026-10-28', clock:'14:40',
  source:'https://www.unicef.org/parenting/child-care/21-learning-activities-babies-and-toddlers',
  schedule:[
    {id:'breakfast',time:'08:00',name:'早餐',person:'奶奶',kind:'meal'},
    {id:'walk',time:'09:30',name:'楼下散步',person:'爸爸',kind:'activity'},
    {id:'lunch',time:'11:30',name:'午餐',person:'奶奶',kind:'meal'},
    {id:'nap',time:'12:30',name:'午睡',person:'爸爸',kind:'rest'},
    {id:'snack',time:'15:00',name:'下午茶',person:'奶奶',kind:'meal'},
    {id:'play',time:'15:30',name:'户外探索',person:'奶奶',kind:'activity'},
    {id:'dinner',time:'17:00',name:'晚餐',person:'奶奶',kind:'meal'},
    {id:'evening',time:'18:00',name:'妈妈陪玩',person:'妈妈',kind:'activity'},
    {id:'bath',time:'19:00',name:'洗澡与睡前陪伴',person:'妈妈',kind:'routine'}
  ],
  pantry:[
    {id:'pumpkin',name:'南瓜',present:true,amount:'够一顿',priority:true},
    {id:'tomato',name:'番茄',present:true,amount:'还有一些',priority:false},
    {id:'egg',name:'鸡蛋',present:true,amount:'还有不少',priority:false},
    {id:'broccoli',name:'西兰花',present:false,amount:'待核对',priority:false},
    {id:'rice',name:'大米 / 熟米饭',present:false,amount:'待核对',priority:false},
    {id:'noodles',name:'面条',present:false,amount:'待核对',priority:false},
    {id:'yogurt',name:'原味酸奶',present:false,amount:'待核对',priority:false}
  ],
  recipes:{
    snack:{name:'蒸南瓜 + 原味酸奶',subtitle:'两样分开准备，照着家里的习惯来',ingredients:['pumpkin','yogurt'],steps:[['先准备南瓜','南瓜去皮、去籽，洗净后切块，放入蒸盘。'],['蒸至软熟','蒸至软熟后取出，按家里平时的吃法处理，放至适宜入口的温度。'],['分开盛好','原味酸奶另盛。食材和份量按家庭已确认的信息准备。']],tip:'原型菜谱示例。实际份量、食物禁忌与接受程度由家庭确认。'},
    pumpkin:{name:'蒸南瓜',subtitle:'保留家里优先吃的南瓜，照着已确认的习惯准备',ingredients:['pumpkin'],steps:[['准备南瓜','南瓜去皮、去籽，洗净后切块，放入蒸盘。'],['蒸至软熟','蒸至软熟后取出，按家里平时的吃法处理，放至适宜入口的温度。']],tip:'家庭自定义下午茶示例，份量与禁忌信息待家庭确认。'},
    noodles:{name:'番茄鸡蛋面',subtitle:'番茄和鸡蛋不变，主食可以灵活替换',ingredients:['tomato','egg','noodles'],steps:[['准备食材','番茄洗净切小块，鸡蛋打散，面条按家庭确认的份量准备。'],['煮面与配菜','面条煮软；番茄煮软后加入鸡蛋，继续煮至鸡蛋完全熟透。'],['合在一起','将面条与配菜拌匀，按平时的接受程度调整，放至适宜入口的温度。']],tip:'家庭自定义菜谱示例，份量待填写；尚未进行专业审核。'},
    rice:{name:'番茄鸡蛋软饭',subtitle:'保留番茄和鸡蛋，把这顿主食换成饭',ingredients:['tomato','egg','rice'],steps:[['准备食材','番茄洗净切小块，鸡蛋打散，准备家庭确认份量的熟米饭。'],['把配菜做熟','锅中炒熟鸡蛋后盛出；番茄煮软，再加入米饭与鸡蛋。'],['调整软硬','少量加水焖软，确认食材熟透，放至适宜入口的温度后再准备食用。']],tip:'家庭自定义菜谱示例，份量待填写；尚未进行专业审核。'}
  },
  activities:{
    outdoor:{name:'找一找秋天的颜色',scene:'户外',icon:'leaf',short:'沿熟悉的路线走走，跟着宝宝的指向，一起说说眼前的颜色。',materials:'熟悉的步行路线，薄外套随身。',steps:[['跟着宝宝，慢慢走','不赶路，留意宝宝停下来看的东西。'],['顺着指向，说一说','宝宝看向哪里，就用一句简单的话描述眼前的颜色或形状。']],purpose:'把日常散步变成有来有回的交流。',observe:'留意宝宝的指向、停留和回应，作为下次调整的线索。',simplify:'先只说一个事物，给宝宝回应的时间；累了就停下来。',note:'沿家庭熟悉的路线活动，由成人持续照看。'},
    indoor:{name:'把积木送回家',scene:'室内',icon:'home',short:'准备大块积木和收纳篮，示范放进去，再轮流试一试。',materials:'大块积木、稳定的收纳篮。',steps:[['先示范，放进去','大人慢慢把一块大积木放进篮子里。'],['轮流试，等一等','把下一块留给宝宝，等待尝试；想停就停。']],purpose:'在简单收纳中安排一次共同动手的游戏。',observe:'宝宝是想拿取、放入，还是先观看？无需用完成数量判断表现。',simplify:'先只留一块积木，把篮子放近一些。',note:'使用前由照护人检查材料；示例内容待核对后启用。'}
  },
  agreements:[
    {id:'try',title:'先等一等，让宝宝试一试',why:'在安全和可以等待的情况下，给宝宝自己尝试的机会。',enabled:true},
    {id:'follow',title:'跟着兴趣，多一点回应',why:'留意宝宝在看什么、指什么，再接着回应。',enabled:false}
  ]
};

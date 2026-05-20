import asyncio
import random
import time
from pathlib import Path

from ErisPulse import sdk
from ErisPulse.Core.Bases import BaseModule
from ErisPulse.Core.Event import command, message, notice
from fastapi import Request
from fastapi.responses import JSONResponse

_MODULE_NAME = "Raffle"
_TEMPLATES_DIR = Path(__file__).parent / "templates"
_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 9L12 2L4 9"/><path d="M12 2v14"/><circle cx="12" cy="20" r="2"/><path d="M4 20h4"/><path d="M16 20h4"/></svg>'

_DEFAULT_PRIZE_CONFIG = {
    "claim_keywords": ["兑奖", "我要兑奖", "领奖", "我要领奖"],
    "claim_method": "info_collect",
    "direct_content": "",
    "per_user_content": {},
    "collect_fields": [],
    "custom_instructions": "",
    "listen_friend_add": True,
}

_DEFAULT_SETTINGS = {
    "current_activity": None,
    "auto_confirm": False,
    "reply_templates": {
        "success": "{name}，你已成功加入「{activity_name}」抽奖名单！\n本次将抽取 {count} 位中奖者，祝你好运！",
        "already_joined": "{name}，你已经在抽奖名单中了，无需重复报名。",
        "hint": "想参与抽奖吗？发送指定关键词即可加入名单！",
        "no_activity": "当前没有进行中的抽奖活动。",
        "closed": "报名已截止，抽奖结果即将揭晓。",
        "drawn": "抽奖已结束，感谢参与！",
        "blacklisted": "你已被加入黑名单，无法参与本次活动。",
        "not_in_whitelist": "本次活动仅限指定用户参与。",
        "pending": "{name}，你的参与申请已提交，等待管理员确认中。",
        "notify": "抽奖活动开始啦！\n\n活动名称：{activity_name}\n活动描述：{description}\n开奖人数：{draw_count} 人\n参与关键词：{keywords}\n\n快来参与吧！",
        "broadcast": "抽奖结果揭晓！\n活动：{activity_name}\n获奖者：{winner_names}\n恭喜以上 {winner_count} 位中奖者！",
        "claim_prompt": "恭喜你中奖了！请回复「我要兑奖」来领取奖品。",
        "claim_success": "{name}，你的兑奖信息已提交，我们会尽快处理！",
        "claim_already": "{name}，你已经兑过奖了。",
        "claim_not_winner": "抱歉，你不是本次活动的获奖者。",
        "claim_no_prize": "当前没有需要兑奖的活动。",
        "claim_friend": "检测到你是中奖者，以下是你的兑奖信息：",
    },
}


class Main(BaseModule):
    def __init__(self):
        self.sdk = sdk
        self.logger = sdk.logger.get_child("Raffle")

    @staticmethod
    def get_load_strategy():
        from ErisPulse.loaders import ModuleLoadStrategy
        return ModuleLoadStrategy(lazy_load=False, priority=50)

    async def on_load(self, event):
        self._ensure_settings()
        self._register_commands()
        self._register_message_handler()
        self._register_claim_handler()
        self._register_friend_add_handler()
        self._register_routes()
        self._register_dashboard_view()
        self.logger.info("Raffle 模块已加载")

    async def on_unload(self, event):
        self._unregister_routes()
        try:
            if hasattr(self.sdk, 'Dashboard') and self.sdk.Dashboard:
                self.sdk.Dashboard.unregister_view(_MODULE_NAME)
        except Exception:
            pass
        self.logger.info("Raffle 模块已卸载")

    def _ensure_settings(self):
        settings = self.sdk.storage.get("raffle:settings")
        if not settings:
            self.sdk.storage.set("raffle:settings", dict(_DEFAULT_SETTINGS))

    def _get_settings(self):
        settings = self.sdk.storage.get("raffle:settings")
        if not settings:
            return dict(_DEFAULT_SETTINGS)
        for k, v in _DEFAULT_SETTINGS.items():
            if k not in settings:
                settings[k] = v
        default_tpl = _DEFAULT_SETTINGS.get("reply_templates", {})
        current_tpl = settings.get("reply_templates", {})
        for k, v in default_tpl.items():
            if k not in current_tpl:
                current_tpl[k] = v
        settings["reply_templates"] = current_tpl
        return settings

    def _save_settings(self, settings):
        self.sdk.storage.set("raffle:settings", settings)

    def _select_best_format(self, platform, templates):
        try:
            supported_methods = self.sdk.adapter.list_sends(platform)
            if "Html" in supported_methods:
                return ("Html", templates["html"])
            elif "Markdown" in supported_methods:
                return ("Markdown", templates["markdown"])
        except Exception:
            pass
        return ("Text", templates["text"])

    def _register_commands(self):
        @command(["raffle", "活动"], help="查看抽奖活动信息")
        async def raffle_cmd(event):
            user_id = event.get_user_id()
            platform = event.get_platform()
            is_group = event.is_group_message()
            group_id = event.get_group_id() if is_group else None

            all_activities = self._get_all_activities()
            joined = []
            for act in all_activities:
                p = self.sdk.storage.get(f"raffle:participant:{act['id']}:{user_id}")
                if p:
                    joined.append({"activity": act, "participant": p})

            group_activities = []
            if is_group and group_id:
                for act in all_activities:
                    for g in act.get("allowed_groups", []):
                        if g["platform"] == platform and g["group_id"] == group_id:
                            group_activities.append(act)
                            break

            templates = self._build_raffle_info(joined, group_activities)
            fmt, content = self._select_best_format(platform, templates)
            try:
                await event.reply(content, method=fmt)
            except Exception:
                await event.reply(templates["text"])

    def _build_raffle_info(self, joined, group_activities):
        status_map = {"open": "报名中", "closed": "已关闭", "drawn": "已开奖"}
        status_color = {"open": "#22c55e", "closed": "#f59e0b", "drawn": "#6366f1"}
        accent = "#6366f1"
        accent_bg = "rgba(99, 102, 241, 0.05)"
        sec_color = "#666"

        joined_html = ""
        if joined:
            items = []
            for item in joined:
                act = item["activity"]
                p = item["participant"]
                st = status_map.get(act.get("status", ""), act.get("status", ""))
                sc = status_color.get(act.get("status", ""), sec_color)
                date_str = time.strftime("%m-%d %H:%M", time.localtime(p.get("joined_at", 0)))
                grp = "已确认" if p.get("group") == "confirmed" else "待确认"
                grp_c = "#22c55e" if p.get("group") == "confirmed" else "#f59e0b"
                items.append(
                    f'<div style="padding:6px 0;border-bottom:1px solid rgba(0,0,0,0.04)">'
                    f'<span style="font-weight:600">{act.get("name", "未命名")}</span>'
                    f' <span style="font-size:12px;color:{sc};margin-left:6px">{st}</span>'
                    f'<div style="font-size:12px;color:{sec_color};margin-top:2px">'
                    f'{date_str} · <span style="color:{grp_c}">{grp}</span></div></div>'
                )
            joined_html = ''.join(items)
        else:
            joined_html = f'<div style="color:{sec_color};font-size:13px">暂未参与任何活动</div>'

        group_html = ""
        if group_activities:
            items = []
            for act in group_activities:
                st = status_map.get(act.get("status", ""), act.get("status", ""))
                sc = status_color.get(act.get("status", ""), sec_color)
                kw = "、".join(act.get("keywords", []))
                confirmed = len(self._get_participants(act["id"], "confirmed"))
                total = len(self._get_participants(act["id"]))
                items.append(
                    f'<div style="padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.04)">'
                    f'<div><span style="font-weight:600">{act.get("name", "未命名")}</span>'
                    f' <span style="font-size:12px;color:{sc};margin-left:6px">{st}</span></div>'
                    f'<div style="font-size:12px;color:{sec_color};margin-top:3px">'
                    f'关键词: {kw} · 开奖 {act.get("draw_count", 1)} 人 · 已报名 {confirmed}/{total}</div></div>'
                )
            group_html = ''.join(items)
        else:
            group_html = f'<div style="color:{sec_color};font-size:13px">当前群聊没有关联活动</div>'

        html = (
            f'<div style="padding:12px;border-radius:10px">'
            f'<div style="color:{accent};font-size:15px;font-weight:700;margin-bottom:8px">我参与的活动</div>'
            f'{joined_html}'
            f'<div style="color:{accent};font-size:15px;font-weight:700;margin:12px 0 8px">本群活动</div>'
            f'{group_html}'
            f'</div>'
        )

        joined_md_lines = ["**我参与的活动**", ""]
        if joined:
            for item in joined:
                act = item["activity"]
                p = item["participant"]
                st = status_map.get(act.get("status", ""), act.get("status", ""))
                date_str = time.strftime("%m-%d %H:%M", time.localtime(p.get("joined_at", 0)))
                joined_md_lines.append(f'- **{act.get("name", "未命名")}** ({st}) — {date_str}')
        else:
            joined_md_lines.append("暂未参与任何活动")

        joined_md_lines.extend(["", "**本群活动**", ""])
        if group_activities:
            for act in group_activities:
                st = status_map.get(act.get("status", ""), act.get("status", ""))
                kw = "、".join(act.get("keywords", []))
                confirmed = len(self._get_participants(act["id"], "confirmed"))
                total = len(self._get_participants(act["id"]))
                joined_md_lines.append(
                    f'- **{act.get("name", "未命名")}** ({st})\n  关键词: {kw} · 开奖 {act.get("draw_count", 1)} 人 · 已报名 {confirmed}/{total}'
                )
        else:
            joined_md_lines.append("当前群聊没有关联活动")

        markdown = '\n'.join(joined_md_lines)

        joined_text_lines = ["我参与的活动", "─" * 20]
        if joined:
            for item in joined:
                act = item["activity"]
                p = item["participant"]
                st = status_map.get(act.get("status", ""), act.get("status", ""))
                date_str = time.strftime("%m-%d %H:%M", time.localtime(p.get("joined_at", 0)))
                joined_text_lines.append(f'  {act.get("name", "未命名")} [{st}] - {date_str}')
        else:
            joined_text_lines.append("  暂未参与任何活动")

        joined_text_lines.extend(["", "本群活动", "─" * 20])
        if group_activities:
            for act in group_activities:
                st = status_map.get(act.get("status", ""), act.get("status", ""))
                kw = "、".join(act.get("keywords", []))
                confirmed = len(self._get_participants(act["id"], "confirmed"))
                total = len(self._get_participants(act["id"]))
                joined_text_lines.append(
                    f'  {act.get("name", "未命名")} [{st}]\n  关键词: {kw} | 开奖 {act.get("draw_count", 1)} 人 | 已报名 {confirmed}/{total}'
                )
        else:
            joined_text_lines.append("  当前群聊没有关联活动")

        text = '\n'.join(joined_text_lines)

        return {"html": html, "markdown": markdown, "text": text}

    def _read_template(self, name):
        path = _TEMPLATES_DIR / name
        if path.exists():
            return path.read_text(encoding='utf-8')
        return ""

    def _get_current_activity(self):
        settings = self._get_settings()
        activity_id = settings.get("current_activity")
        if not activity_id:
            return None
        return self.sdk.storage.get(f"raffle:activity:{activity_id}")

    def _get_all_activities(self):
        activity_ids = self.sdk.storage.get("raffle:activities:list", [])
        activities = []
        for aid in activity_ids:
            act = self.sdk.storage.get(f"raffle:activity:{aid}")
            if act:
                activities.append(act)
        return activities

    def _get_participants(self, activity_id, group=None):
        prefix = f"raffle:participant:{activity_id}:"
        keys = self.sdk.storage.keys()
        participants = []
        for key in keys:
            if key.startswith(prefix):
                data = self.sdk.storage.get(key)
                if data and (group is None or data.get("group") == group):
                    participants.append(data)
        participants.sort(key=lambda x: x.get("joined_at", 0))
        return participants

    def _get_blacklist(self, activity_id):
        return self.sdk.storage.get(f"raffle:blacklist:{activity_id}", [])

    def _save_blacklist(self, activity_id, blacklist):
        self.sdk.storage.set(f"raffle:blacklist:{activity_id}", blacklist)

    def _get_whitelist(self, activity_id):
        return self.sdk.storage.get(f"raffle:whitelist:{activity_id}", [])

    def _save_whitelist(self, activity_id, whitelist):
        self.sdk.storage.set(f"raffle:whitelist:{activity_id}", whitelist)

    def _get_claims(self, activity_id):
        return self.sdk.storage.get(f"raffle:claims:{activity_id}", [])

    def _save_claims(self, activity_id, claims):
        self.sdk.storage.set(f"raffle:claims:{activity_id}", claims)

    def _get_claim(self, activity_id, user_id):
        claims = self._get_claims(activity_id)
        for c in claims:
            if c.get("user_id") == user_id:
                return c
        return None

    def _save_claim(self, activity_id, claim):
        claims = self._get_claims(activity_id)
        for i, c in enumerate(claims):
            if c.get("user_id") == claim["user_id"]:
                claims[i] = claim
                self._save_claims(activity_id, claims)
                return
        claims.append(claim)
        self._save_claims(activity_id, claims)

    def _find_winner_activities(self, user_id):
        result = []
        for act in self._get_all_activities():
            if act.get("status") != "drawn":
                continue
            dr = act.get("draw_result")
            if not dr or not dr.get("winners"):
                continue
            for w in dr["winners"]:
                if w.get("user_id") == user_id:
                    result.append(act)
                    break
        return result

    async def _execute_claim_flow(self, event, activity, user_id, user_name, platform):
        activity_id = activity["id"]
        settings = self._get_settings()
        tpl = settings.get("reply_templates", {})
        existing = self._get_claim(activity_id, user_id)
        if existing and existing.get("status") in ("claimed", "completed"):
            await event.reply(tpl.get("claim_already", "").format(name=user_name))
            return

        prize_config = activity.get("prize_config", {})
        claim_method = prize_config.get("claim_method", "info_collect")

        if claim_method == "direct":
            per_user = prize_config.get("per_user_content", {})
            content = per_user.get(user_id, prize_config.get("direct_content", ""))
            if not content:
                content = prize_config.get("direct_content", "请联系管理员领取奖品")
            await event.reply(content)
            self._save_claim(activity_id, {
                "user_id": user_id,
                "user_name": user_name,
                "platform": platform,
                "status": "claimed",
                "claimed_at": int(time.time()),
                "data": {},
            })
            self.logger.info(f"用户 {user_name}({user_id}) 已兑奖(直接发送): {activity_id}")

        elif claim_method == "info_collect":
            fields = prize_config.get("collect_fields", [])
            if not fields:
                await event.reply("兑奖信息收集尚未配置，请联系管理员。")
                return
            data = await event.collect(fields, timeout_per_field=120)
            if data:
                self._save_claim(activity_id, {
                    "user_id": user_id,
                    "user_name": user_name,
                    "platform": platform,
                    "status": "claimed",
                    "claimed_at": int(time.time()),
                    "data": data,
                })
                await event.reply(tpl.get("claim_success", "").format(name=user_name))
                self.logger.info(f"用户 {user_name}({user_id}) 已兑奖(信息收集): {activity_id}")
            else:
                await event.reply("兑奖已取消或超时，请重新发起。")

        elif claim_method == "custom":
            instructions = prize_config.get("custom_instructions", "请联系管理员领取奖品")
            await event.reply(instructions)
            self._save_claim(activity_id, {
                "user_id": user_id,
                "user_name": user_name,
                "platform": platform,
                "status": "claimed",
                "claimed_at": int(time.time()),
                "data": {},
            })
            self.logger.info(f"用户 {user_name}({user_id}) 已兑奖(自定义): {activity_id}")

    def _register_message_handler(self):
        @message.on_message()
        async def handle_raffle_message(event):
            if not event.is_group_message():
                return

            activity = self._get_current_activity()
            if not activity:
                return

            if activity.get("status") != "open":
                return

            platform = event.get_platform()
            group_id = event.get_group_id()
            allowed = False
            for g in activity.get("allowed_groups", []):
                if g["platform"] == platform and g["group_id"] == group_id:
                    allowed = True
                    break
            if not allowed:
                return

            text = event.get_text()
            keywords = activity.get("keywords", [])
            matched = any(kw in text for kw in keywords)

            if not matched:
                return

            settings = self._get_settings()
            tpl = settings.get("reply_templates", {})

            user_id = event.get_user_id()
            user_name = event.get_user_nickname() or "开发者"
            activity_id = activity["id"]

            blacklist = self._get_blacklist(activity_id)
            if any(b.get("user_id") == user_id for b in blacklist):
                await event.reply(tpl.get("blacklisted", "你已被加入抽奖黑名单"))
                return

            whitelist_mode = activity.get("whitelist_mode", False)
            if whitelist_mode:
                whitelist = self._get_whitelist(activity_id)
                if not any(w.get("user_id") == user_id for w in whitelist):
                    await event.reply(tpl.get("not_in_whitelist", "本次活动仅限指定用户参与"))
                    return

            existing = self.sdk.storage.get(f"raffle:participant:{activity_id}:{user_id}")
            if existing:
                await event.reply(tpl.get("already_joined", "").format(name=user_name))
                return

            auto_confirm = settings.get("auto_confirm", False) or activity.get("auto_confirm", False)
            user_group = "confirmed" if auto_confirm else "pending"

            self.sdk.storage.set(f"raffle:participant:{activity_id}:{user_id}", {
                "user_id": user_id,
                "user_name": user_name,
                "platform": platform,
                "joined_at": int(time.time()),
                "group": user_group,
            })

            if user_group == "pending":
                await event.reply(tpl.get("pending", "").format(name=user_name))
            else:
                await event.reply(tpl.get("success", "").format(
                    name=user_name,
                    count=activity.get("draw_count", 1),
                    activity_name=activity.get("name", "抽奖活动"),
                ))

    def _register_claim_handler(self):
        @message.on_message(priority=20)
        async def handle_claim_message(event):
            text = event.get_text()
            if not text:
                return

            user_id = event.get_user_id()
            user_name = event.get_user_nickname() or "用户"
            platform = event.get_platform()

            winner_acts = self._find_winner_activities(user_id)
            if not winner_acts:
                return

            matched_activities = []
            for act in winner_acts:
                pc = act.get("prize_config", {})
                claim_kw = pc.get("claim_keywords", ["兑奖", "我要兑奖", "领奖"])
                if any(kw in text for kw in claim_kw):
                    matched_activities.append(act)

            if not matched_activities:
                return

            settings = self._get_settings()
            tpl = settings.get("reply_templates", {})

            if len(matched_activities) == 1:
                await self._execute_claim_flow(event, matched_activities[0], user_id, user_name, platform)
            else:
                options = [a.get("name", a["id"]) for a in matched_activities]
                choice = await event.choose(
                    tpl.get("claim_no_prize", "请选择要兑奖的活动："),
                    options,
                    timeout=60,
                )
                if choice is not None:
                    await self._execute_claim_flow(event, matched_activities[choice], user_id, user_name, platform)

    def _register_friend_add_handler(self):
        @notice.on_friend_add()
        async def handle_friend_add(event):
            user_id = event.get_user_id()
            user_name = event.get_user_nickname() or "用户"
            platform = event.get_platform()

            winner_acts = self._find_winner_activities(user_id)
            if not winner_acts:
                return

            settings = self._get_settings()
            tpl = settings.get("reply_templates", {})

            for act in winner_acts:
                pc = act.get("prize_config", {})
                if not pc.get("listen_friend_add", True):
                    continue
                existing = self._get_claim(act["id"], user_id)
                if existing and existing.get("status") in ("claimed", "completed"):
                    continue
                await event.reply(tpl.get("claim_friend", "").format(name=user_name))
                await asyncio.sleep(0.5)

    def _verify_token(self, request: Request) -> bool:
        token = self._get_token(request)
        if not token:
            return False
        try:
            dashboard = self.sdk.Dashboard
            if dashboard and hasattr(dashboard, '_verify_token'):
                return dashboard._verify_token(token)
        except Exception:
            pass
        return False

    def _get_token(self, request: Request) -> str | None:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            return auth[7:]
        return request.query_params.get("token")

    def _register_routes(self):
        r = self.sdk.router
        mn = _MODULE_NAME
        r.register_http_route(mn, "/api/platforms", handler=self._api_platforms, methods=["GET"])
        r.register_http_route(mn, "/api/settings", handler=self._api_settings_get, methods=["GET"])
        r.register_http_route(mn, "/api/settings", handler=self._api_settings_put, methods=["PUT"])
        r.register_http_route(mn, "/api/activities", handler=self._api_activities_list, methods=["GET"])
        r.register_http_route(mn, "/api/activities", handler=self._api_activities_create, methods=["POST"])
        r.register_http_route(mn, "/api/activities/{activity_id}", handler=self._api_activities_get, methods=["GET"])
        r.register_http_route(mn, "/api/activities/{activity_id}", handler=self._api_activities_update, methods=["PUT"])
        r.register_http_route(mn, "/api/activities/{activity_id}", handler=self._api_activities_delete, methods=["DELETE"])
        r.register_http_route(mn, "/api/activities/{activity_id}/participants", handler=self._api_participants, methods=["GET"])
        r.register_http_route(mn, "/api/activities/{activity_id}/participants/{user_id}", handler=self._api_participant_action, methods=["PUT"])
        r.register_http_route(mn, "/api/activities/{activity_id}/participants/{user_id}", handler=self._api_participant_remove, methods=["DELETE"])
        r.register_http_route(mn, "/api/activities/{activity_id}/draw", handler=self._api_draw, methods=["POST"])
        r.register_http_route(mn, "/api/activities/{activity_id}/draw/revert", handler=self._api_draw_revert, methods=["POST"])
        r.register_http_route(mn, "/api/activities/{activity_id}/result", handler=self._api_result, methods=["GET"])
        r.register_http_route(mn, "/api/activities/{activity_id}/blacklist", handler=self._api_blacklist_get, methods=["GET"])
        r.register_http_route(mn, "/api/activities/{activity_id}/blacklist", handler=self._api_blacklist_update, methods=["PUT"])
        r.register_http_route(mn, "/api/activities/{activity_id}/whitelist", handler=self._api_whitelist_get, methods=["GET"])
        r.register_http_route(mn, "/api/activities/{activity_id}/whitelist", handler=self._api_whitelist_update, methods=["PUT"])
        r.register_http_route(mn, "/api/activities/{activity_id}/notify", handler=self._api_notify_send, methods=["POST"])
        r.register_http_route(mn, "/api/activities/{activity_id}/notify/history", handler=self._api_notify_history, methods=["GET"])
        r.register_http_route(mn, "/api/activities/{activity_id}/notify/resend/{history_id}", handler=self._api_notify_resend, methods=["POST"])
        r.register_http_route(mn, "/api/activities/{activity_id}/claims", handler=self._api_claims_get, methods=["GET"])
        r.register_http_route(mn, "/api/activities/{activity_id}/claims/{user_id}", handler=self._api_claims_update, methods=["PUT"])

    def _unregister_routes(self):
        r = self.sdk.router
        mn = _MODULE_NAME
        for p in [
            "/api/platforms", "/api/settings",
            "/api/activities", "/api/activities/{activity_id}",
            "/api/activities/{activity_id}/participants",
            "/api/activities/{activity_id}/participants/{user_id}",
            "/api/activities/{activity_id}/draw",
            "/api/activities/{activity_id}/draw/revert",
            "/api/activities/{activity_id}/result",
            "/api/activities/{activity_id}/blacklist",
            "/api/activities/{activity_id}/whitelist",
            "/api/activities/{activity_id}/notify",
            "/api/activities/{activity_id}/notify/history",
            "/api/activities/{activity_id}/notify/resend/{history_id}",
            "/api/activities/{activity_id}/claims",
            "/api/activities/{activity_id}/claims/{user_id}",
        ]:
            try:
                r.unregister_http_route(mn, p)
            except Exception:
                pass

    def _register_dashboard_view(self):
        try:
            dashboard = self.sdk.Dashboard
            if not dashboard:
                self.logger.warning("Dashboard 不可用，跳过视窗注册")
                return
            dashboard.register_view(
                id=_MODULE_NAME,
                title="抽奖管理", title_en="Raffle",
                icon_svg=_ICON_SVG,
                html_content=self._read_template("view.html"),
                js_content=self._read_template("view.js"),
                css_content=self._read_template("view.css"),
                loader="loadRaffleView",
                group="group_tools",
            )
            self.logger.info("Dashboard 视窗已注册")
        except Exception as e:
            self.logger.warning(f"Dashboard 视窗注册失败: {e}")

    async def _api_platforms(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        platforms = list(self.sdk.adapter.list_registered())
        return JSONResponse({"platforms": platforms})

    async def _api_settings_get(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        return JSONResponse({"settings": self._get_settings()})

    async def _api_settings_put(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        body = await request.json()
        settings = self._get_settings()
        new_settings = body.get("settings", {})
        settings.update(new_settings)
        self._save_settings(settings)
        self.logger.info("模块设置已更新")
        return JSONResponse({"success": True})

    async def _api_activities_list(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activities = self._get_all_activities()
        for act in activities:
            if "prize_config" not in act:
                act["prize_config"] = dict(_DEFAULT_PRIZE_CONFIG)
        return JSONResponse({"activities": activities})

    async def _api_activities_create(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        activity_id = body.get("id", f"act_{int(time.time())}")
        activity = {
            "id": activity_id,
            "name": body.get("name", "未命名活动"),
            "description": body.get("description", ""),
            "draw_count": body.get("draw_count", 1),
            "keywords": body.get("keywords", ["抽奖", "参与抽奖"]),
            "allowed_groups": body.get("allowed_groups", []),
            "auto_confirm": body.get("auto_confirm", False),
            "whitelist_mode": body.get("whitelist_mode", False),
            "status": "open",
            "created_at": int(time.time()),
            "draw_result": None,
            "prize_config": {**_DEFAULT_PRIZE_CONFIG, **body.get("prize_config", {})},
        }
        self.sdk.storage.set(f"raffle:activity:{activity_id}", activity)
        activity_ids = self.sdk.storage.get("raffle:activities:list", [])
        if activity_id not in activity_ids:
            activity_ids.append(activity_id)
            self.sdk.storage.set("raffle:activities:list", activity_ids)
        settings = self._get_settings()
        if not settings.get("current_activity"):
            settings["current_activity"] = activity_id
            self._save_settings(settings)
        self.logger.info(f"活动已创建: {activity_id}")
        return JSONResponse({"success": True, "activity": activity})

    async def _api_activities_get(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        activity = self.sdk.storage.get(f"raffle:activity:{activity_id}")
        if not activity:
            return JSONResponse({"error": "活动不存在"}, status_code=404)
        confirmed = self._get_participants(activity_id, "confirmed")
        pending = self._get_participants(activity_id, "pending")
        activity["participant_count"] = len(confirmed)
        activity["pending_count"] = len(pending)
        if "prize_config" not in activity:
            activity["prize_config"] = dict(_DEFAULT_PRIZE_CONFIG)
        return JSONResponse({"activity": activity})

    async def _api_activities_update(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        activity = self.sdk.storage.get(f"raffle:activity:{activity_id}")
        if not activity:
            return JSONResponse({"error": "活动不存在"}, status_code=404)
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        for key in ["name", "description", "draw_count", "keywords", "allowed_groups",
                     "status", "auto_confirm", "whitelist_mode"]:
            if key in body:
                activity[key] = body[key]
        if "prize_config" in body:
            current_pc = activity.get("prize_config", {})
            activity["prize_config"] = {**_DEFAULT_PRIZE_CONFIG, **current_pc, **body["prize_config"]}
        self.sdk.storage.set(f"raffle:activity:{activity_id}", activity)
        self.logger.info(f"活动已更新: {activity_id}")
        return JSONResponse({"success": True, "activity": activity})

    async def _api_activities_delete(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        all_participants = self._get_participants(activity_id)
        for p in all_participants:
            self.sdk.storage.delete(f"raffle:participant:{activity_id}:{p['user_id']}")
        self.sdk.storage.delete(f"raffle:activity:{activity_id}")
        self.sdk.storage.delete(f"raffle:blacklist:{activity_id}")
        self.sdk.storage.delete(f"raffle:whitelist:{activity_id}")
        activity_ids = self.sdk.storage.get("raffle:activities:list", [])
        if activity_id in activity_ids:
            activity_ids.remove(activity_id)
            self.sdk.storage.set("raffle:activities:list", activity_ids)
        settings = self._get_settings()
        if settings.get("current_activity") == activity_id:
            settings["current_activity"] = activity_ids[0] if activity_ids else None
            self._save_settings(settings)
        self.logger.info(f"活动已删除: {activity_id}")
        return JSONResponse({"success": True})

    async def _api_participants(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        confirmed = self._get_participants(activity_id, "confirmed")
        pending = self._get_participants(activity_id, "pending")
        return JSONResponse({"confirmed": confirmed, "pending": pending})

    async def _api_participant_action(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        user_id = request.path_params.get("user_id", "")
        body = await request.json()
        action = body.get("action", "")
        key = f"raffle:participant:{activity_id}:{user_id}"
        data = self.sdk.storage.get(key)
        if not data:
            return JSONResponse({"error": "参与者不存在"}, status_code=404)
        if action == "confirm":
            data["group"] = "confirmed"
            self.sdk.storage.set(key, data)
            return JSONResponse({"success": True, "group": "confirmed"})
        elif action == "revoke":
            data["group"] = "pending"
            self.sdk.storage.set(key, data)
            return JSONResponse({"success": True, "group": "pending"})
        return JSONResponse({"error": "未知操作"}, status_code=400)

    async def _api_participant_remove(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        user_id = request.path_params.get("user_id", "")
        self.sdk.storage.delete(f"raffle:participant:{activity_id}:{user_id}")
        self.logger.info(f"参与者已移除: {user_id} 从活动 {activity_id}")
        return JSONResponse({"success": True})

    async def _api_draw(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        activity = self.sdk.storage.get(f"raffle:activity:{activity_id}")
        if not activity:
            return JSONResponse({"error": "活动不存在"}, status_code=404)
        if activity.get("status") != "open":
            return JSONResponse({"error": "活动不在报名中状态"}, status_code=400)

        confirmed = self._get_participants(activity_id, "confirmed")
        draw_count = min(activity.get("draw_count", 1), len(confirmed))
        if draw_count == 0:
            return JSONResponse({"error": "没有已确认的参与者可以抽奖"}, status_code=400)

        winners = random.sample(confirmed, draw_count)
        draw_result = {
            "winners": winners,
            "drawn_at": int(time.time()),
            "total_participants": len(confirmed),
        }
        activity["status"] = "drawn"
        activity["draw_result"] = draw_result
        self.sdk.storage.set(f"raffle:activity:{activity_id}", activity)

        self.logger.info(f"活动 {activity_id} 开奖完成，获奖者: {[w['user_name'] for w in winners]}")
        asyncio.create_task(self._broadcast_result(activity, winners))

        return JSONResponse({
            "success": True,
            "winners": winners,
            "total_participants": len(confirmed),
        })

    async def _api_result(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        activity = self.sdk.storage.get(f"raffle:activity:{activity_id}")
        if not activity:
            return JSONResponse({"error": "活动不存在"}, status_code=404)
        return JSONResponse({
            "activity_id": activity_id,
            "activity_name": activity.get("name", ""),
            "status": activity.get("status", ""),
            "draw_result": activity.get("draw_result"),
        })

    async def _api_draw_revert(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        activity = self.sdk.storage.get(f"raffle:activity:{activity_id}")
        if not activity:
            return JSONResponse({"error": "活动不存在"}, status_code=404)
        if activity.get("status") != "drawn":
            return JSONResponse({"error": "活动不在已开奖状态"}, status_code=400)
        activity["status"] = "open"
        activity["draw_result"] = None
        self.sdk.storage.set(f"raffle:activity:{activity_id}", activity)
        self.logger.info(f"活动 {activity_id} 开奖已撤回")
        return JSONResponse({"success": True, "activity": activity})

    async def _api_blacklist_get(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        return JSONResponse({"blacklist": self._get_blacklist(activity_id)})

    async def _api_blacklist_update(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        body = await request.json()
        blacklist = body.get("blacklist", [])
        self._save_blacklist(activity_id, blacklist)
        self.logger.info(f"黑名单已更新: 活动 {activity_id}")
        return JSONResponse({"success": True})

    async def _api_whitelist_get(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        return JSONResponse({"whitelist": self._get_whitelist(activity_id)})

    async def _api_whitelist_update(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        body = await request.json()
        whitelist = body.get("whitelist", [])
        self._save_whitelist(activity_id, whitelist)
        self.logger.info(f"白名单已更新: 活动 {activity_id}")
        return JSONResponse({"success": True})

    async def _broadcast_result(self, activity, winners):
        winner_names = "、".join([w["user_name"] for w in winners])
        settings = self._get_settings()
        tpl = settings.get("reply_templates", {})
        broadcast_tpl = tpl.get("broadcast", "")
        if broadcast_tpl:
            text = broadcast_tpl.format(
                activity_name=activity.get("name", "抽奖活动"),
                winner_names=winner_names,
                winner_count=len(winners),
                total_participants=len(self._get_participants(activity["id"])),
            )
        else:
            text = (
                f"抽奖结果揭晓！\n"
                f"活动：{activity.get('name', '抽奖活动')}\n"
                f"获奖者：{winner_names}\n"
                f"恭喜以上 {len(winners)} 位中奖者！"
            )
        for group in activity.get("allowed_groups", []):
            try:
                adapter = self.sdk.adapter.get(group["platform"])
                if adapter:
                    await adapter.Send.To("group", group["group_id"]).Text(text)
                    self.logger.info(f"广播已发送: {group['platform']}/{group['group_id']}")
            except Exception as e:
                self.logger.error(f"广播失败 {group['platform']}/{group['group_id']}: {e}")

    def _get_notify_history(self, activity_id):
        return self.sdk.storage.get(f"raffle:notify_history:{activity_id}", [])

    def _save_notify_history(self, activity_id, history):
        self.sdk.storage.set(f"raffle:notify_history:{activity_id}", history)

    def _build_notify_message(self, activity, custom_content=""):
        settings = self._get_settings()
        tpl = settings.get("reply_templates", {}).get("notify", "")
        message = tpl.format(
            activity_name=activity.get("name", "抽奖活动"),
            description=activity.get("description", ""),
            draw_count=activity.get("draw_count", 1),
            keywords="、".join(activity.get("keywords", [])),
        )
        if custom_content:
            message += "\n\n" + custom_content
        return message

    async def _send_notifications(self, activity, targets, custom_content=""):
        message = self._build_notify_message(activity, custom_content)
        results = []
        for target in targets:
            platform = target.get("platform", "")
            session_type = target.get("session_type", "")
            target_id = target.get("target_id", "")
            account_id = target.get("account_id", "")
            if not platform or not session_type or not target_id:
                results.append({
                    "platform": platform, "session_type": session_type,
                    "target_id": target_id, "success": False, "error": "缺少必要参数",
                })
                continue
            try:
                adapter = self.sdk.adapter.get(platform)
                if not adapter:
                    results.append({
                        "platform": platform, "session_type": session_type,
                        "target_id": target_id, "success": False, "error": "适配器不可用",
                    })
                    continue
                send_dsl = adapter.Send
                if account_id:
                    send_dsl = send_dsl.Using(account_id)
                await send_dsl.To(session_type, target_id).Text(message)
                results.append({
                    "platform": platform, "session_type": session_type,
                    "target_id": target_id, "success": True, "error": None,
                })
                self.logger.info(f"通知已发送: {platform}/{session_type}/{target_id}")
            except Exception as e:
                results.append({
                    "platform": platform, "session_type": session_type,
                    "target_id": target_id, "success": False, "error": str(e),
                })
                self.logger.error(f"通知发送失败: {platform}/{session_type}/{target_id}: {e}")
        return message, results

    async def _api_notify_send(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        activity = self.sdk.storage.get(f"raffle:activity:{activity_id}")
        if not activity:
            return JSONResponse({"error": "活动不存在"}, status_code=404)

        body = await request.json()
        targets = body.get("targets", [])
        custom_content = body.get("custom_content", "")

        if not targets:
            return JSONResponse({"error": "至少需要一个发送目标"}, status_code=400)

        message, results = await self._send_notifications(activity, targets, custom_content)

        history = self._get_notify_history(activity_id)
        record = {
            "id": f"notify_{int(time.time() * 1000)}",
            "targets": targets,
            "custom_content": custom_content,
            "message": message,
            "sent_at": int(time.time()),
            "results": results,
        }
        history.insert(0, record)
        self._save_notify_history(activity_id, history)

        success_count = sum(1 for r in results if r.get("success"))
        self.logger.info(f"活动通知发送完成: {activity_id}, 成功 {success_count}/{len(targets)}")
        return JSONResponse({
            "success": True,
            "record": record,
            "success_count": success_count,
            "total_count": len(targets),
        })

    async def _api_notify_history(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        activity = self.sdk.storage.get(f"raffle:activity:{activity_id}")
        if not activity:
            return JSONResponse({"error": "活动不存在"}, status_code=404)
        history = self._get_notify_history(activity_id)
        return JSONResponse({"history": history})

    async def _api_notify_resend(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        history_id = request.path_params.get("history_id", "")
        activity = self.sdk.storage.get(f"raffle:activity:{activity_id}")
        if not activity:
            return JSONResponse({"error": "活动不存在"}, status_code=404)

        history = self._get_notify_history(activity_id)
        record = None
        for h in history:
            if h.get("id") == history_id:
                record = h
                break
        if not record:
            return JSONResponse({"error": "记录不存在"}, status_code=404)

        targets = record.get("targets", [])
        custom_content = record.get("custom_content", "")
        message, results = await self._send_notifications(activity, targets, custom_content)

        new_record = {
            "id": f"notify_{int(time.time() * 1000)}",
            "targets": targets,
            "custom_content": custom_content,
            "message": message,
            "sent_at": int(time.time()),
            "results": results,
            "resent_from": history_id,
        }
        history.insert(0, new_record)
        self._save_notify_history(activity_id, history)

        success_count = sum(1 for r in results if r.get("success"))
        return JSONResponse({
            "success": True,
            "record": new_record,
            "success_count": success_count,
            "total_count": len(targets),
        })

    async def _api_claims_get(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        activity = self.sdk.storage.get(f"raffle:activity:{activity_id}")
        if not activity:
            return JSONResponse({"error": "活动不存在"}, status_code=404)
        claims = self._get_claims(activity_id)
        return JSONResponse({"claims": claims, "total": len(claims)})

    async def _api_claims_update(self, request: Request) -> JSONResponse:
        if not self._verify_token(request):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        activity_id = request.path_params.get("activity_id", "")
        user_id = request.path_params.get("user_id", "")
        activity = self.sdk.storage.get(f"raffle:activity:{activity_id}")
        if not activity:
            return JSONResponse({"error": "活动不存在"}, status_code=404)
        body = await request.json()
        action = body.get("action", "")

        if action == "update_status":
            claim = self._get_claim(activity_id, user_id)
            if not claim:
                return JSONResponse({"error": "兑奖记录不存在"}, status_code=404)
            claim["status"] = body.get("status", claim["status"])
            if body.get("admin_note"):
                claim["admin_note"] = body["admin_note"]
            self._save_claim(activity_id, claim)
            return JSONResponse({"success": True, "claim": claim})

        elif action == "update_per_user_content":
            pc = activity.get("prize_config", {})
            puc = pc.get("per_user_content", {})
            puc[user_id] = body.get("content", "")
            pc["per_user_content"] = puc
            activity["prize_config"] = pc
            self.sdk.storage.set(f"raffle:activity:{activity_id}", activity)
            return JSONResponse({"success": True})

        return JSONResponse({"error": "未知操作"}, status_code=400)

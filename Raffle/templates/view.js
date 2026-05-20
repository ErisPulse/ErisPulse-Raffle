var _rfState = {
    platforms: [],
    activities: [],
    currentId: null,
    currentActivity: null,
    confirmed: [],
    pending: [],
    allParticipants: [],
    activeGroup: 'all',
    editMode: false,
    editId: null,
    tempGroups: [],
    blacklist: [],
    whitelist: [],
    notifyTargets: [],
    notifyActivityId: null,
    notifyHistory: [],
    collectFields: [],
    claims: [],
    claimContentUserId: null,
};

function loadRaffleView() {
    rfLoadPlatforms();
    rfLoadActivities();
    rfLoadSettings();
}

function _rfTk() {
    return localStorage.getItem('__ep_tk__');
}

function _rfHeaders() {
    return { 'Authorization': 'Bearer ' + _rfTk(), 'Content-Type': 'application/json' };
}

function rfLoadPlatforms() {
    fetch('/Raffle/api/platforms', { headers: _rfHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            _rfState.platforms = d.platforms || [];
            var sel = document.getElementById('rf-f-platform');
            var sel2 = document.getElementById('rf-nf-platform');
            if (sel) {
                sel.innerHTML = '<option value="">选择平台</option>';
                _rfState.platforms.forEach(function(p) {
                    var opt = document.createElement('option');
                    opt.value = p;
                    opt.textContent = p;
                    sel.appendChild(opt);
                });
            }
            if (sel2) {
                sel2.innerHTML = '<option value="">平台</option>';
                _rfState.platforms.forEach(function(p) {
                    var opt = document.createElement('option');
                    opt.value = p;
                    opt.textContent = p;
                    sel2.appendChild(opt);
                });
            }
        })
        .catch(function() {});
}

function rfLoadActivities() {
    fetch('/Raffle/api/activities', { headers: _rfHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            _rfState.activities = d.activities || [];
            rfRenderActivityList();
        })
        .catch(function() {});
}

function rfLoadSettings() {
    fetch('/Raffle/api/settings', { headers: _rfHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var settings = d.settings || {};
            _rfState.currentId = settings.current_activity || null;
            var tpl = settings.reply_templates || {};
            var elS = document.getElementById('rf-tpl-success');
            var elJ = document.getElementById('rf-tpl-joined');
            var elH = document.getElementById('rf-tpl-hint');
            var elP = document.getElementById('rf-tpl-pending');
            var elNA = document.getElementById('rf-tpl-noactivity');
            var elBL = document.getElementById('rf-tpl-blacklisted');
            var elNWL = document.getElementById('rf-tpl-notwhitelist');
            if (elS) elS.value = tpl.success || '';
            if (elJ) elJ.value = tpl.already_joined || '';
            if (elH) elH.value = tpl.hint || '';
            if (elP) elP.value = tpl.pending || '';
            if (elNA) elNA.value = tpl.no_activity || '';
            if (elBL) elBL.value = tpl.blacklisted || '';
            if (elNWL) elNWL.value = tpl.not_in_whitelist || '';
            var elN = document.getElementById('rf-tpl-notify');
            if (elN) elN.value = tpl.notify || '';
            var elBC = document.getElementById('rf-tpl-broadcast');
            if (elBC) elBC.value = tpl.broadcast || '';
            var elCS = document.getElementById('rf-tpl-claim-success');
            if (elCS) elCS.value = tpl.claim_success || '';
            var elCF = document.getElementById('rf-tpl-claim-friend');
            if (elCF) elCF.value = tpl.claim_friend || '';

            if (_rfState.currentId) {
                rfSelectActivity(_rfState.currentId);
            }
        })
        .catch(function() {});
}

function rfRenderActivityList() {
    var el = document.getElementById('rf-activity-list');
    if (!el) return;

    if (_rfState.activities.length === 0) {
        el.innerHTML = '<div style="text-align:center;padding:16px;color:var(--tx-t)">暂无活动，点击右上角创建</div>';
        rfUpdateStats(null);
        return;
    }

    var html = '';
    _rfState.activities.forEach(function(act) {
        var statusText = act.status === 'open' ? '报名中' : (act.status === 'drawn' ? '已开奖' : '已关闭');
        var statusClass = act.status === 'open' ? 'chip-ok' : (act.status === 'drawn' ? 'chip-sc' : 'chip-wr');
        var isCurrent = act.id === _rfState.currentId;
        html += '<div class="rf-activity-item' + (isCurrent ? ' rf-current' : '') + '" onclick="rfSelectActivity(\'' + rfEsc(act.id) + '\')">';
        html += '<div style="flex:1;cursor:pointer">';
        html += '<div style="font-weight:600;margin-bottom:2px">' + rfEsc(act.name) + '</div>';
        html += '<div style="font-size:12px;color:var(--tx-t)">' + rfEsc(act.id) + ' · 开奖 ' + act.draw_count + ' 人';
        if (act.whitelist_mode) html += ' · <span style="color:var(--wr-c)">白名单</span>';
        html += '</div></div>';
        html += '<span class="chip ' + statusClass + '">' + statusText + '</span>';
        html += '<button class="btn btn-icon btn-sm" title="编辑" onclick="event.stopPropagation();rfEditActivity(\'' + rfEsc(act.id) + '\')" style="margin-left:4px">';
        html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
        html += '</button>';
        html += '<button class="btn btn-icon btn-sm" title="发送通知" onclick="event.stopPropagation();rfShowNotify(\'' + rfEsc(act.id) + '\')" style="margin-left:2px">';
        html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>';
        html += '</button>';
        html += '<button class="btn btn-icon btn-sm" title="删除" onclick="event.stopPropagation();rfDeleteActivity(\'' + rfEsc(act.id) + '\')" style="margin-left:2px">';
        html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
        html += '</button>';
        html += '</div>';
    });
    el.innerHTML = html;
}

function rfSelectActivity(id) {
    _rfState.currentId = id;
    rfRenderActivityList();
    rfLoadActivityDetail(id);
    rfLoadParticipants(id);
    rfLoadBlacklist(id);
    rfLoadWhitelist(id);
    rfLoadClaims();
}

function rfLoadActivityDetail(id) {
    fetch('/Raffle/api/activities/' + encodeURIComponent(id), { headers: _rfHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var act = d.activity;
            if (!act) return;
            _rfState.currentActivity = act;
            rfUpdateStats(act);

            if (act.status === 'drawn') {
                document.getElementById('rf-draw-btn').style.display = 'none';
                document.getElementById('rf-draw-result-btn').style.display = 'inline-flex';
                var revertBtn = document.getElementById('rf-draw-revert-btn');
                if (revertBtn) revertBtn.style.display = 'inline-flex';
            } else if (act.status === 'open') {
                document.getElementById('rf-draw-btn').style.display = 'inline-flex';
                document.getElementById('rf-draw-btn').disabled = false;
                document.getElementById('rf-draw-result-btn').style.display = 'none';
                var revertBtn = document.getElementById('rf-draw-revert-btn');
                if (revertBtn) revertBtn.style.display = 'none';
            } else {
                document.getElementById('rf-draw-btn').style.display = 'none';
                document.getElementById('rf-draw-result-btn').style.display = 'none';
                var revertBtn = document.getElementById('rf-draw-revert-btn');
                if (revertBtn) revertBtn.style.display = 'none';
            }
        })
        .catch(function() {});
}

function rfUpdateStats(act) {
    var elName = document.getElementById('rf-stat-current');
    var elConfirmed = document.getElementById('rf-stat-confirmed');
    var elDraw = document.getElementById('rf-stat-draw');
    var elStatus = document.getElementById('rf-stat-status');

    if (!act) {
        if (elName) elName.textContent = '未选择';
        if (elConfirmed) elConfirmed.textContent = '0';
        if (elDraw) elDraw.textContent = '0';
        if (elStatus) elStatus.textContent = '--';
        return;
    }
    if (elName) elName.textContent = act.name || act.id;
    if (elConfirmed) elConfirmed.textContent = act.participant_count || 0;
    if (elDraw) elDraw.textContent = act.draw_count || 0;
    var statusMap = { open: '报名中', closed: '已关闭', drawn: '已开奖' };
    if (elStatus) elStatus.textContent = statusMap[act.status] || act.status;
}

function rfLoadParticipants(activityId) {
    fetch('/Raffle/api/activities/' + encodeURIComponent(activityId) + '/participants', { headers: _rfHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            _rfState.confirmed = d.confirmed || [];
            _rfState.pending = d.pending || [];
            _rfState.allParticipants = _rfState.confirmed.concat(_rfState.pending);
            rfRenderParticipants();
        })
        .catch(function() {});
}

function rfSwitchGroup(group) {
    _rfState.activeGroup = group;
    var tabs = document.querySelectorAll('#rf-group-tabs .rf-tab');
    tabs.forEach(function(t) {
        if (t.getAttribute('data-group') === group) {
            t.classList.add('rf-tab-active');
        } else {
            t.classList.remove('rf-tab-active');
        }
    });
    rfRenderParticipants();
}

function rfGetDisplayList() {
    var list;
    if (_rfState.activeGroup === 'confirmed') {
        list = _rfState.confirmed;
    } else if (_rfState.activeGroup === 'pending') {
        list = _rfState.pending;
    } else {
        list = _rfState.allParticipants;
    }
    return list;
}

function rfRenderParticipants(filter) {
    var empty = document.getElementById('rf-participants-empty');
    var table = document.getElementById('rf-participants-table');
    var body = document.getElementById('rf-participants-body');
    var countEl = document.getElementById('rf-participant-count');
    if (!body) return;

    var list = rfGetDisplayList();
    if (filter) {
        var fl = filter.toLowerCase();
        list = list.filter(function(p) {
            return (p.user_name || '').toLowerCase().indexOf(fl) >= 0 ||
                   (p.user_id || '').toLowerCase().indexOf(fl) >= 0;
        });
    }

    var total = _rfState.confirmed.length + _rfState.pending.length;
    if (countEl) countEl.textContent = '(' + _rfState.confirmed.length + ' 已确认 / ' + _rfState.pending.length + ' 待录入 / 共 ' + total + ' 人)';

    if (list.length === 0) {
        if (empty) empty.style.display = 'block';
        if (table) table.style.display = 'none';
        return;
    }
    if (empty) empty.style.display = 'none';
    if (table) table.style.display = 'table';

    var html = '';
    list.forEach(function(p, i) {
        var date = p.joined_at ? new Date(p.joined_at * 1000).toLocaleString() : '--';
        var groupLabel = p.group === 'confirmed' ? '<span class="rf-group-tag rf-group-confirmed">已确认</span>' : '<span class="rf-group-tag rf-group-pending">待录入</span>';
        html += '<tr>';
        html += '<td>' + (i + 1) + '</td>';
        html += '<td>' + rfEsc(p.user_name || '--') + '</td>';
        html += '<td style="font-size:12px;font-family:monospace">' + rfEsc(p.user_id) + '</td>';
        html += '<td><span class="chip chip-pr">' + rfEsc(p.platform || '--') + '</span></td>';
        html += '<td>' + groupLabel + '</td>';
        html += '<td style="font-size:12px;color:var(--tx-s)">' + date + '</td>';
        html += '<td><div style="display:flex;gap:4px">';
        if (p.group === 'pending') {
            html += '<button class="btn btn-primary btn-xs" onclick="rfConfirmParticipant(\'' + rfEsc(p.user_id) + '\')">确认</button>';
        } else {
            html += '<button class="btn btn-secondary btn-xs" onclick="rfRevokeParticipant(\'' + rfEsc(p.user_id) + '\')">撤回</button>';
        }
        html += '<button class="btn btn-danger btn-xs" onclick="rfRemoveParticipant(\'' + rfEsc(p.user_id) + '\')">移除</button>';
        html += '</div></td>';
        html += '</tr>';
    });
    body.innerHTML = html;
}

function rfFilterParticipants() {
    var input = document.getElementById('rf-search');
    rfRenderParticipants(input ? input.value : '');
}

function rfConfirmParticipant(userId) {
    if (!_rfState.currentId) return;
    fetch('/Raffle/api/activities/' + encodeURIComponent(_rfState.currentId) + '/participants/' + encodeURIComponent(userId), {
        method: 'PUT', headers: _rfHeaders(),
        body: JSON.stringify({ action: 'confirm' })
    })
        .then(function(r) { return r.json(); })
        .then(function() { rfLoadParticipants(_rfState.currentId); rfLoadActivityDetail(_rfState.currentId); })
        .catch(function() {});
}

function rfRevokeParticipant(userId) {
    if (!_rfState.currentId) return;
    fetch('/Raffle/api/activities/' + encodeURIComponent(_rfState.currentId) + '/participants/' + encodeURIComponent(userId), {
        method: 'PUT', headers: _rfHeaders(),
        body: JSON.stringify({ action: 'revoke' })
    })
        .then(function(r) { return r.json(); })
        .then(function() { rfLoadParticipants(_rfState.currentId); rfLoadActivityDetail(_rfState.currentId); })
        .catch(function() {});
}

function rfRemoveParticipant(userId) {
    if (!_rfState.currentId) return;
    if (!confirm('确定移除该参与者？')) return;
    fetch('/Raffle/api/activities/' + encodeURIComponent(_rfState.currentId) + '/participants/' + encodeURIComponent(userId), {
        method: 'DELETE', headers: _rfHeaders()
    })
        .then(function(r) { return r.json(); })
        .then(function() { rfLoadParticipants(_rfState.currentId); rfLoadActivityDetail(_rfState.currentId); })
        .catch(function() {});
}

function rfShowCreate() {
    _rfState.editMode = false;
    _rfState.editId = null;
    _rfState.tempGroups = [];
    document.getElementById('rf-create-title').textContent = '创建新活动';
    document.getElementById('rf-f-id').value = '';
    document.getElementById('rf-f-id').disabled = false;
    document.getElementById('rf-f-name').value = '';
    document.getElementById('rf-f-desc').value = '';
    document.getElementById('rf-f-draw').value = '5';
    document.getElementById('rf-f-keywords').value = '我想要礼物,想要礼物,参与抽奖,抽奖,周边';
    document.getElementById('rf-f-autoconfirm').checked = false;
    document.getElementById('rf-f-autoconfirm-label').textContent = '关闭';
    document.getElementById('rf-f-whitelist').checked = false;
    document.getElementById('rf-f-whitelist-label').textContent = '关闭';
    _rfState.collectFields = [];
    rfRenderCollectFields();
    document.getElementById('rf-f-claim-method').value = 'info_collect';
    rfClaimMethodChange();
    document.getElementById('rf-f-direct-content').value = '';
    document.getElementById('rf-f-custom-instructions').value = '';
    document.getElementById('rf-f-claim-keywords').value = '兑奖,我要兑奖,领奖';
    document.getElementById('rf-f-listen-friend').checked = true;
    document.getElementById('rf-f-listen-friend-label').textContent = '开启';
    rfRenderGroupsList();
    document.getElementById('rf-create-panel').style.display = 'block';
}

function rfHideCreate() {
    document.getElementById('rf-create-panel').style.display = 'none';
}

function rfEditActivity(id) {
    var act = _rfState.activities.find(function(a) { return a.id === id; });
    if (!act) return;
    _rfState.editMode = true;
    _rfState.editId = id;
    _rfState.tempGroups = (act.allowed_groups || []).slice();
    document.getElementById('rf-create-title').textContent = '编辑活动: ' + act.name;
    document.getElementById('rf-f-id').value = act.id;
    document.getElementById('rf-f-id').disabled = true;
    document.getElementById('rf-f-name').value = act.name || '';
    document.getElementById('rf-f-desc').value = act.description || '';
    document.getElementById('rf-f-draw').value = act.draw_count || 1;
    document.getElementById('rf-f-keywords').value = (act.keywords || []).join(',');
    document.getElementById('rf-f-autoconfirm').checked = !!act.auto_confirm;
    document.getElementById('rf-f-autoconfirm-label').textContent = act.auto_confirm ? '开启' : '关闭';
    document.getElementById('rf-f-whitelist').checked = !!act.whitelist_mode;
    document.getElementById('rf-f-whitelist-label').textContent = act.whitelist_mode ? '开启' : '关闭';
    var pc = act.prize_config || {};
    document.getElementById('rf-f-claim-method').value = pc.claim_method || 'info_collect';
    rfClaimMethodChange();
    _rfState.collectFields = (pc.collect_fields || []).slice();
    rfRenderCollectFields();
    document.getElementById('rf-f-direct-content').value = pc.direct_content || '';
    document.getElementById('rf-f-custom-instructions').value = pc.custom_instructions || '';
    document.getElementById('rf-f-claim-keywords').value = (pc.claim_keywords || []).join(',');
    document.getElementById('rf-f-listen-friend').checked = pc.listen_friend_add !== false;
    document.getElementById('rf-f-listen-friend-label').textContent = pc.listen_friend_add !== false ? '开启' : '关闭';
    rfRenderGroupsList();
    document.getElementById('rf-create-panel').style.display = 'block';
}

function rfAddGroup() {
    var platform = document.getElementById('rf-f-platform').value;
    var groupId = document.getElementById('rf-f-groupid').value.trim();
    if (!platform || !groupId) return;
    var exists = _rfState.tempGroups.some(function(g) { return g.platform === platform && g.group_id === groupId; });
    if (exists) return;
    _rfState.tempGroups.push({ platform: platform, group_id: groupId });
    document.getElementById('rf-f-groupid').value = '';
    rfRenderGroupsList();
}

function rfRemoveGroup(idx) {
    _rfState.tempGroups.splice(idx, 1);
    rfRenderGroupsList();
}

function rfRenderGroupsList() {
    var el = document.getElementById('rf-groups-list');
    if (!el) return;
    if (_rfState.tempGroups.length === 0) {
        el.innerHTML = '<div style="font-size:12px;color:var(--tx-t)">暂未添加群聊</div>';
        return;
    }
    var html = '';
    _rfState.tempGroups.forEach(function(g, i) {
        html += '<div style="display:flex;align-items:center;gap:8px;margin:4px 0">';
        html += '<span class="chip chip-pr">' + rfEsc(g.platform) + '</span>';
        html += '<span style="font-size:13px;font-family:monospace">' + rfEsc(g.group_id) + '</span>';
        html += '<button class="btn btn-icon btn-xs" onclick="rfRemoveGroup(' + i + ')">';
        html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        html += '</button></div>';
    });
    el.innerHTML = html;
}

function rfSaveActivity() {
    var id = document.getElementById('rf-f-id').value.trim();
    var name = document.getElementById('rf-f-name').value.trim();
    var desc = document.getElementById('rf-f-desc').value.trim();
    var drawCount = parseInt(document.getElementById('rf-f-draw').value) || 1;
    var keywordsStr = document.getElementById('rf-f-keywords').value.trim();
    var keywords = keywordsStr ? keywordsStr.split(',').map(function(k) { return k.trim(); }).filter(Boolean) : [];
    var autoConfirm = document.getElementById('rf-f-autoconfirm').checked;
    var whitelistMode = document.getElementById('rf-f-whitelist').checked;
    var claimMethod = document.getElementById('rf-f-claim-method').value;
    var claimKeywordsStr = document.getElementById('rf-f-claim-keywords').value.trim();
    var claimKeywords = claimKeywordsStr ? claimKeywordsStr.split(',').map(function(k) { return k.trim(); }).filter(Boolean) : [];
    var directContent = document.getElementById('rf-f-direct-content').value;
    var customInstructions = document.getElementById('rf-f-custom-instructions').value;
    var listenFriend = document.getElementById('rf-f-listen-friend').checked;

    var prizeConfig = {
        claim_method: claimMethod,
        claim_keywords: claimKeywords,
        direct_content: directContent,
        custom_instructions: customInstructions,
        collect_fields: _rfState.collectFields.slice(),
        listen_friend_add: listenFriend,
    };

    if (!name) { alert('请输入活动名称'); return; }

    var url, method, body;
    if (_rfState.editMode) {
        url = '/Raffle/api/activities/' + encodeURIComponent(_rfState.editId);
        method = 'PUT';
        body = JSON.stringify({
            name: name, description: desc, draw_count: drawCount,
            keywords: keywords, allowed_groups: _rfState.tempGroups,
            auto_confirm: autoConfirm, whitelist_mode: whitelistMode,
            prize_config: prizeConfig,
        });
    } else {
        url = '/Raffle/api/activities';
        method = 'POST';
        body = JSON.stringify({
            id: id || undefined, name: name, description: desc,
            draw_count: drawCount, keywords: keywords,
            allowed_groups: _rfState.tempGroups,
            auto_confirm: autoConfirm, whitelist_mode: whitelistMode,
            prize_config: prizeConfig,
        });
    }

    fetch(url, { method: method, headers: _rfHeaders(), body: body })
        .then(function(r) {
            if (!r.ok) return r.text().then(function(t) { throw new Error(t || 'HTTP ' + r.status); });
            return r.json();
        })
        .then(function(d) {
            if (d.error) { alert('保存失败: ' + d.error); return; }
            rfHideCreate();
            rfLoadActivities();
            if (d.activity && d.activity.id) {
                rfSelectActivity(d.activity.id);
            }
        })
        .catch(function(e) { alert('保存失败: ' + e); });
}

function rfDeleteActivity(id) {
    if (!confirm('确定删除此活动？所有参与者数据将被清除！')) return;
    fetch('/Raffle/api/activities/' + encodeURIComponent(id), { method: 'DELETE', headers: _rfHeaders() })
        .then(function(r) { return r.json(); })
        .then(function() {
            if (_rfState.currentId === id) {
                _rfState.currentId = null;
                _rfState.currentActivity = null;
            }
            rfLoadActivities();
        })
        .catch(function(e) { alert('删除失败: ' + e); });
}

function rfStartDraw() {
    if (!_rfState.currentId) { alert('请先选择活动'); return; }
    var act = _rfState.activities.find(function(a) { return a.id === _rfState.currentId; });
    if (!act) return;
    if (!confirm('确定对「' + act.name + '」开奖？开奖后报名将关闭，仅从「已确认」参与者中抽取。')) return;

    document.getElementById('rf-draw-idle').style.display = 'none';
    document.getElementById('rf-draw-animating').style.display = 'block';
    document.getElementById('rf-draw-done').style.display = 'none';

    var names = _rfState.confirmed.map(function(p) { return p.user_name || p.user_id; });
    if (names.length === 0) {
        document.getElementById('rf-draw-animating').style.display = 'none';
        document.getElementById('rf-draw-idle').style.display = 'block';
        alert('没有已确认的参与者');
        return;
    }

    var slotEl = document.getElementById('rf-draw-slot');
    var drawCount = Math.min(act.draw_count || 1, names.length);
    var animDuration = 3500;
    var startTime = Date.now();
    var interval = 80;

    var animTimer = setInterval(function() {
        var elapsed = Date.now() - startTime;
        var progress = Math.min(elapsed / animDuration, 1);
        var delay = interval + (progress * progress * 600);

        var displayNames = [];
        for (var i = 0; i < drawCount; i++) {
            displayNames.push(names[Math.floor(Math.random() * names.length)]);
        }
        slotEl.textContent = displayNames.join('  /  ');

        if (progress >= 1) {
            clearInterval(animTimer);
            rfDoDraw();
        } else {
            setTimeout(function() {}, delay - interval);
        }
    }, interval);
}

function rfDoDraw() {
    fetch('/Raffle/api/activities/' + encodeURIComponent(_rfState.currentId) + '/draw', {
        method: 'POST', headers: _rfHeaders()
    })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.error) {
                document.getElementById('rf-draw-animating').style.display = 'none';
                document.getElementById('rf-draw-idle').style.display = 'block';
                alert('开奖失败: ' + d.error);
                return;
            }
            rfShowDrawResult(d.winners, d.total_participants);
            rfLoadActivities();
        })
        .catch(function(e) {
            document.getElementById('rf-draw-animating').style.display = 'none';
            document.getElementById('rf-draw-idle').style.display = 'block';
            alert('开奖请求失败: ' + e);
        });
}

function rfShowDrawResult(winners, total) {
    document.getElementById('rf-draw-animating').style.display = 'none';
    document.getElementById('rf-draw-done').style.display = 'block';

    document.getElementById('rf-draw-summary').textContent =
        '共 ' + total + ' 人参与，抽取 ' + winners.length + ' 位获奖者';

    var html = '<div class="rf-winners-grid">';
    winners.forEach(function(w, i) {
        html += '<div class="rf-winner-card">';
        html += '<div class="rf-winner-rank">' + (i + 1) + '</div>';
        html += '<div class="rf-winner-name">' + rfEsc(w.user_name || '--') + '</div>';
        html += '<div class="rf-winner-id">' + rfEsc(w.user_id) + '</div>';
        html += '<div class="rf-winner-platform"><span class="chip chip-pr">' + rfEsc(w.platform || '--') + '</span></div>';
        html += '</div>';
    });
    html += '</div>';
    document.getElementById('rf-winners-list').innerHTML = html;
}

function rfShowResult() {
    if (!_rfState.currentId) return;
    fetch('/Raffle/api/activities/' + encodeURIComponent(_rfState.currentId) + '/result', { headers: _rfHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var result = d.draw_result;
            if (!result || !result.winners) { alert('暂无开奖结果'); return; }
            document.getElementById('rf-draw-idle').style.display = 'none';
            document.getElementById('rf-draw-animating').style.display = 'none';
            rfShowDrawResult(result.winners, result.total_participants);
        })
        .catch(function(e) { alert('加载失败: ' + e); });
}

function rfRevertDraw() {
    if (!_rfState.currentId) return;
    var act = _rfState.activities.find(function(a) { return a.id === _rfState.currentId; });
    if (!act) return;
    if (!confirm('确定撤回「' + act.name + '」的开奖结果？\n开奖结果将被清除，活动将恢复为报名中状态。')) return;
    fetch('/Raffle/api/activities/' + encodeURIComponent(_rfState.currentId) + '/draw/revert', {
        method: 'POST', headers: _rfHeaders()
    })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.error) { alert('撤回失败: ' + d.error); return; }
            document.getElementById('rf-draw-done').style.display = 'none';
            document.getElementById('rf-draw-idle').style.display = 'block';
            rfLoadActivities();
            rfSelectActivity(_rfState.currentId);
        })
        .catch(function(e) { alert('撤回请求失败: ' + e); });
}

function rfLoadBlacklist(activityId) {
    fetch('/Raffle/api/activities/' + encodeURIComponent(activityId) + '/blacklist', { headers: _rfHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            _rfState.blacklist = d.blacklist || [];
            rfRenderBlacklist();
        })
        .catch(function() {});
}

function rfLoadWhitelist(activityId) {
    fetch('/Raffle/api/activities/' + encodeURIComponent(activityId) + '/whitelist', { headers: _rfHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            _rfState.whitelist = d.whitelist || [];
            rfRenderWhitelist();
        })
        .catch(function() {});
}

function rfAddBlacklist() {
    if (!_rfState.currentId) { alert('请先选择活动'); return; }
    var userId = document.getElementById('rf-bl-input').value.trim();
    if (!userId) return;
    var remark = document.getElementById('rf-bl-name').value.trim();
    _rfState.blacklist.push({ user_id: userId, remark: remark });
    document.getElementById('rf-bl-input').value = '';
    document.getElementById('rf-bl-name').value = '';
    rfSaveBlacklist();
}

function rfRemoveBlacklist(idx) {
    _rfState.blacklist.splice(idx, 1);
    rfSaveBlacklist();
}

function rfSaveBlacklist() {
    if (!_rfState.currentId) return;
    fetch('/Raffle/api/activities/' + encodeURIComponent(_rfState.currentId) + '/blacklist', {
        method: 'PUT', headers: _rfHeaders(),
        body: JSON.stringify({ blacklist: _rfState.blacklist })
    })
        .then(function() { rfRenderBlacklist(); })
        .catch(function() {});
}

function rfRenderBlacklist() {
    var el = document.getElementById('rf-blacklist-tags');
    if (!el) return;
    if (_rfState.blacklist.length === 0) {
        el.innerHTML = '<span style="font-size:12px;color:var(--tx-t)">暂无黑名单</span>';
        return;
    }
    var html = '';
    _rfState.blacklist.forEach(function(b, i) {
        html += '<span class="rf-user-tag rf-user-tag-bl">';
        html += rfEsc(b.remark || b.user_id);
        if (b.remark) html += ' <span style="opacity:0.6;font-size:11px">' + rfEsc(b.user_id) + '</span>';
        html += ' <span class="rf-user-tag-x" onclick="rfRemoveBlacklist(' + i + ')">×</span>';
        html += '</span>';
    });
    el.innerHTML = html;
}

function rfAddWhitelist() {
    if (!_rfState.currentId) { alert('请先选择活动'); return; }
    var userId = document.getElementById('rf-wl-input').value.trim();
    if (!userId) return;
    var remark = document.getElementById('rf-wl-name').value.trim();
    _rfState.whitelist.push({ user_id: userId, remark: remark });
    document.getElementById('rf-wl-input').value = '';
    document.getElementById('rf-wl-name').value = '';
    rfSaveWhitelist();
}

function rfRemoveWhitelist(idx) {
    _rfState.whitelist.splice(idx, 1);
    rfSaveWhitelist();
}

function rfSaveWhitelist() {
    if (!_rfState.currentId) return;
    fetch('/Raffle/api/activities/' + encodeURIComponent(_rfState.currentId) + '/whitelist', {
        method: 'PUT', headers: _rfHeaders(),
        body: JSON.stringify({ whitelist: _rfState.whitelist })
    })
        .then(function() { rfRenderWhitelist(); })
        .catch(function() {});
}

function rfRenderWhitelist() {
    var el = document.getElementById('rf-whitelist-tags');
    if (!el) return;
    if (_rfState.whitelist.length === 0) {
        el.innerHTML = '<span style="font-size:12px;color:var(--tx-t)">暂无白名单</span>';
        return;
    }
    var html = '';
    _rfState.whitelist.forEach(function(w, i) {
        html += '<span class="rf-user-tag rf-user-tag-wl">';
        html += rfEsc(w.remark || w.user_id);
        if (w.remark) html += ' <span style="opacity:0.6;font-size:11px">' + rfEsc(w.user_id) + '</span>';
        html += ' <span class="rf-user-tag-x" onclick="rfRemoveWhitelist(' + i + ')">×</span>';
        html += '</span>';
    });
    el.innerHTML = html;
}

function rfSaveTemplates() {
    var templates = {
        success: document.getElementById('rf-tpl-success').value,
        already_joined: document.getElementById('rf-tpl-joined').value,
        hint: document.getElementById('rf-tpl-hint').value,
        pending: document.getElementById('rf-tpl-pending').value,
        no_activity: document.getElementById('rf-tpl-noactivity').value,
        blacklisted: document.getElementById('rf-tpl-blacklisted').value,
        not_in_whitelist: document.getElementById('rf-tpl-notwhitelist').value,
        notify: document.getElementById('rf-tpl-notify').value,
        broadcast: document.getElementById('rf-tpl-broadcast').value,
        claim_success: document.getElementById('rf-tpl-claim-success').value,
        claim_friend: document.getElementById('rf-tpl-claim-friend').value,
    };
    fetch('/Raffle/api/settings', {
        method: 'PUT',
        headers: _rfHeaders(),
        body: JSON.stringify({ settings: { reply_templates: templates } })
    })
        .then(function(r) { return r.json(); })
        .then(function() { alert('模板已保存'); })
        .catch(function(e) { alert('保存失败: ' + e); });
}

function rfEsc(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
}

function rfClaimMethodChange() {
    var method = document.getElementById('rf-f-claim-method').value;
    document.getElementById('rf-claim-direct').style.display = method === 'direct_send' ? 'block' : 'none';
    document.getElementById('rf-claim-collect').style.display = method === 'info_collect' ? 'block' : 'none';
    document.getElementById('rf-claim-custom').style.display = method === 'custom' ? 'block' : 'none';
}

function rfAddCollectField() {
    var key = document.getElementById('rf-cf-key').value.trim();
    var prompt = document.getElementById('rf-cf-prompt').value.trim();
    if (!key || !prompt) { alert('请填写字段标识和提示语'); return; }
    if (_rfState.collectFields.some(function(f) { return f.key === key; })) { alert('字段标识已存在'); return; }
    _rfState.collectFields.push({ key: key, prompt: prompt });
    document.getElementById('rf-cf-key').value = '';
    document.getElementById('rf-cf-prompt').value = '';
    rfRenderCollectFields();
}

function rfRemoveCollectField(idx) {
    _rfState.collectFields.splice(idx, 1);
    rfRenderCollectFields();
}

function rfRenderCollectFields() {
    var el = document.getElementById('rf-collect-fields-list');
    if (!el) return;
    if (_rfState.collectFields.length === 0) {
        el.innerHTML = '<div style="font-size:12px;color:var(--tx-t)">暂未添加收集字段</div>';
        return;
    }
    var html = '';
    _rfState.collectFields.forEach(function(f, i) {
        html += '<div style="display:flex;align-items:center;gap:8px;margin:4px 0;padding:4px 8px;background:var(--bg-s);border-radius:6px">';
        html += '<span style="font-weight:600;font-size:13px">' + rfEsc(f.key) + '</span>';
        html += '<span style="color:var(--tx-t);font-size:12px;flex:1">' + rfEsc(f.prompt) + '</span>';
        html += '<button class="btn btn-icon btn-xs" onclick="rfRemoveCollectField(' + i + ')">';
        html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        html += '</button></div>';
    });
    el.innerHTML = html;
}

function rfLoadClaims() {
    if (!_rfState.currentId) return;
    fetch('/Raffle/api/activities/' + encodeURIComponent(_rfState.currentId) + '/claims', { headers: _rfHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            _rfState.claims = d.claims || [];
            rfRenderClaims();
        })
        .catch(function() { _rfState.claims = []; rfRenderClaims(); });
}

function rfRenderClaims() {
    var empty = document.getElementById('rf-claims-empty');
    var table = document.getElementById('rf-claims-table');
    var body = document.getElementById('rf-claims-body');
    if (!body) return;

    if (_rfState.claims.length === 0) {
        if (empty) empty.style.display = 'block';
        if (table) table.style.display = 'none';
        return;
    }
    if (empty) empty.style.display = 'none';
    if (table) table.style.display = 'table';

    var html = '';
    _rfState.claims.forEach(function(c) {
        var date = c.claimed_at ? new Date(c.claimed_at * 1000).toLocaleString() : '--';
        var statusMap = { claimed: '已兑奖', completed: '已完成' };
        var statusClass = c.status === 'completed' ? 'chip-ok' : 'chip-sc';
        var methodMap = { direct_send: '直接发送', info_collect: '信息收集', custom: '自定义' };
        var dataStr = '';
        if (c.data && typeof c.data === 'object') {
            dataStr = Object.keys(c.data).map(function(k) { return k + ': ' + c.data[k]; }).join(', ');
        }
        html += '<tr>';
        html += '<td>' + rfEsc(c.user_name || '--') + '</td>';
        html += '<td style="font-size:12px;font-family:monospace">' + rfEsc(c.user_id) + '</td>';
        html += '<td><span class="chip chip-pr">' + rfEsc(c.platform || '--') + '</span></td>';
        html += '<td style="font-size:12px">' + rfEsc(methodMap[c.method] || '--') + '</td>';
        html += '<td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + rfEsc(dataStr) + '">' + rfEsc(dataStr || '--') + '</td>';
        html += '<td><span class="chip ' + statusClass + '">' + rfEsc(statusMap[c.status] || c.status) + '</span></td>';
        html += '<td style="font-size:12px;color:var(--tx-s)">' + date + '</td>';
        html += '<td><div style="display:flex;gap:4px">';
        if (c.status === 'claimed') {
            html += '<button class="btn btn-primary btn-xs" onclick="rfUpdateClaimStatus(\'' + rfEsc(c.user_id) + '\', \'completed\')">完成</button>';
        }
        html += '<button class="btn btn-secondary btn-xs" onclick="rfShowClaimContent(\'' + rfEsc(c.user_id) + '\')">专属内容</button>';
        html += '</div></td>';
        html += '</tr>';
    });
    body.innerHTML = html;
}

function rfUpdateClaimStatus(userId, status) {
    if (!_rfState.currentId) return;
    fetch('/Raffle/api/activities/' + encodeURIComponent(_rfState.currentId) + '/claims/' + encodeURIComponent(userId), {
        method: 'PUT', headers: _rfHeaders(),
        body: JSON.stringify({ action: 'update_status', status: status })
    })
        .then(function(r) { return r.json(); })
        .then(function() { rfLoadClaims(); })
        .catch(function(e) { alert('操作失败: ' + e); });
}

function rfShowClaimContent(userId) {
    _rfState.claimContentUserId = userId;
    var act = _rfState.currentActivity;
    var puc = (act && act.prize_config && act.prize_config.per_user_content) || {};
    var el = document.getElementById('rf-cc-content');
    if (el) el.value = puc[userId] || '';
    var info = document.getElementById('rf-cc-user-info');
    if (info) info.textContent = '用户: ' + userId;
    document.getElementById('rf-claim-content-modal').style.display = 'flex';
}

function rfHideClaimContent() {
    document.getElementById('rf-claim-content-modal').style.display = 'none';
    _rfState.claimContentUserId = null;
}

function rfSaveClaimContent() {
    if (!_rfState.currentId || !_rfState.claimContentUserId) return;
    var content = document.getElementById('rf-cc-content').value;
    fetch('/Raffle/api/activities/' + encodeURIComponent(_rfState.currentId) + '/claims/' + encodeURIComponent(_rfState.claimContentUserId), {
        method: 'PUT', headers: _rfHeaders(),
        body: JSON.stringify({ action: 'update_per_user_content', content: content })
    })
        .then(function(r) { return r.json(); })
        .then(function() { rfHideClaimContent(); rfLoadActivityDetail(_rfState.currentId); })
        .catch(function(e) { alert('保存失败: ' + e); });
}

document.addEventListener('DOMContentLoaded', function() {
    var acCb = document.getElementById('rf-f-autoconfirm');
    if (acCb) acCb.addEventListener('change', function() {
        document.getElementById('rf-f-autoconfirm-label').textContent = this.checked ? '开启' : '关闭';
    });
    var wlCb = document.getElementById('rf-f-whitelist');
    if (wlCb) wlCb.addEventListener('change', function() {
        document.getElementById('rf-f-whitelist-label').textContent = this.checked ? '开启' : '关闭';
    });
    var lfCb = document.getElementById('rf-f-listen-friend');
    if (lfCb) lfCb.addEventListener('change', function() {
        document.getElementById('rf-f-listen-friend-label').textContent = this.checked ? '开启' : '关闭';
    });
});

function rfShowNotify(activityId) {
    _rfState.notifyActivityId = activityId;
    _rfState.notifyTargets = [];
    var act = _rfState.activities.find(function(a) { return a.id === activityId; });
    if (!act) { alert('活动不存在'); return; }
    var nameEl = document.getElementById('rf-notify-act-name');
    var descEl = document.getElementById('rf-notify-act-desc');
    if (nameEl) nameEl.textContent = act.name || act.id;
    if (descEl) descEl.textContent = act.description || '';
    var customEl = document.getElementById('rf-nf-custom');
    if (customEl) customEl.value = '';
    rfRenderNotifyTargets();
    rfPreviewNotify();
    rfLoadNotifyHistory(activityId);
    rfNotifyTab('send');
    document.getElementById('rf-notify-modal').style.display = 'flex';
}

function rfHideNotify() {
    document.getElementById('rf-notify-modal').style.display = 'none';
    _rfState.notifyActivityId = null;
    _rfState.notifyTargets = [];
}

function rfNotifyTab(tab) {
    var tabs = document.querySelectorAll('.rf-modal-tabs .rf-tab');
    tabs.forEach(function(t) {
        if (t.getAttribute('data-ntab') === tab) {
            t.classList.add('rf-tab-active');
        } else {
            t.classList.remove('rf-tab-active');
        }
    });
    document.getElementById('rf-notify-send').style.display = tab === 'send' ? 'block' : 'none';
    document.getElementById('rf-notify-history').style.display = tab === 'history' ? 'block' : 'none';
}

function rfAddNotifyTarget() {
    var platform = document.getElementById('rf-nf-platform').value;
    var sessionType = document.getElementById('rf-nf-type').value;
    var targetId = document.getElementById('rf-nf-targetid').value.trim();
    var accountId = document.getElementById('rf-nf-accountid').value.trim();
    if (!platform || !targetId) { alert('请选择平台并输入目标 ID'); return; }
    var exists = _rfState.notifyTargets.some(function(t) {
        return t.platform === platform && t.session_type === sessionType && t.target_id === targetId;
    });
    if (exists) { alert('该目标已添加'); return; }
    _rfState.notifyTargets.push({
        platform: platform,
        session_type: sessionType,
        target_id: targetId,
        account_id: accountId
    });
    document.getElementById('rf-nf-targetid').value = '';
    document.getElementById('rf-nf-accountid').value = '';
    rfRenderNotifyTargets();
}

function rfRemoveNotifyTarget(idx) {
    _rfState.notifyTargets.splice(idx, 1);
    rfRenderNotifyTargets();
}

function rfRenderNotifyTargets() {
    var el = document.getElementById('rf-notify-targets');
    if (!el) return;
    if (_rfState.notifyTargets.length === 0) {
        el.innerHTML = '<div style="font-size:12px;color:var(--tx-t)">暂未添加发送目标</div>';
        return;
    }
    var html = '';
    _rfState.notifyTargets.forEach(function(t, i) {
        var typeLabels = { user: '私聊', group: '群聊', channel: '频道', guild: '服务器', thread: '话题' };
        html += '<div class="rf-target-item">';
        html += '<span class="chip chip-pr">' + rfEsc(t.platform) + '</span>';
        html += '<span style="color:var(--tx-t)">' + (typeLabels[t.session_type] || t.session_type) + '</span>';
        html += '<span style="font-family:monospace;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + rfEsc(t.target_id) + '</span>';
        if (t.account_id) html += '<span style="font-size:11px;color:var(--tx-t)">@' + rfEsc(t.account_id) + '</span>';
        html += '<button class="btn btn-icon btn-xs" onclick="rfRemoveNotifyTarget(' + i + ')">';
        html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        html += '</button></div>';
    });
    el.innerHTML = html;
}

function rfPreviewNotify() {
    var act = _rfState.activities.find(function(a) { return a.id === _rfState.notifyActivityId; });
    var el = document.getElementById('rf-notify-preview');
    if (!el || !act) return;
    var tplEl = document.getElementById('rf-tpl-notify');
    var tpl = tplEl ? tplEl.value : '';
    if (!tpl) { el.textContent = '请先在回复模板中配置活动通知模板'; return; }
    var customEl = document.getElementById('rf-nf-custom');
    var custom = customEl ? customEl.value : '';
    var msg = tpl
        .replace(/\{activity_name\}/g, act.name || '抽奖活动')
        .replace(/\{description\}/g, act.description || '')
        .replace(/\{draw_count\}/g, act.draw_count || 1)
        .replace(/\{keywords\}/g, (act.keywords || []).join('、'));
    if (custom) msg += '\n\n' + custom;
    el.textContent = msg;
}

function rfSendNotify() {
    if (!_rfState.notifyActivityId) return;
    if (_rfState.notifyTargets.length === 0) { alert('请至少添加一个发送目标'); return; }
    var btn = document.getElementById('rf-notify-send-btn');
    if (btn) { btn.disabled = true; btn.textContent = '发送中...'; }
    var customEl = document.getElementById('rf-nf-custom');
    fetch('/Raffle/api/activities/' + encodeURIComponent(_rfState.notifyActivityId) + '/notify', {
        method: 'POST',
        headers: _rfHeaders(),
        body: JSON.stringify({
            targets: _rfState.notifyTargets,
            custom_content: customEl ? customEl.value : ''
        })
    })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (btn) { btn.disabled = false; btn.textContent = '发送'; }
            if (d.error) { alert('发送失败: ' + d.error); return; }
            var info = '发送完成：成功 ' + d.success_count + '/' + d.total_count;
            if (d.success_count < d.total_count) {
                var fails = d.record.results.filter(function(r) { return !r.success; });
                info += '\n失败: ' + fails.map(function(f) { return f.platform + '/' + f.target_id + ' - ' + f.error; }).join(', ');
            }
            alert(info);
            rfLoadNotifyHistory(_rfState.notifyActivityId);
        })
        .catch(function(e) {
            if (btn) { btn.disabled = false; btn.textContent = '发送'; }
            alert('发送请求失败: ' + e);
        });
}

function rfLoadNotifyHistory(activityId) {
    fetch('/Raffle/api/activities/' + encodeURIComponent(activityId) + '/notify/history', { headers: _rfHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            _rfState.notifyHistory = d.history || [];
            rfRenderNotifyHistory();
        })
        .catch(function() { _rfState.notifyHistory = []; rfRenderNotifyHistory(); });
}

function rfRenderNotifyHistory() {
    var el = document.getElementById('rf-history-list');
    if (!el) return;
    if (_rfState.notifyHistory.length === 0) {
        el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--tx-t)">暂无发送记录</div>';
        return;
    }
    var html = '';
    _rfState.notifyHistory.forEach(function(h) {
        var date = h.sent_at ? new Date(h.sent_at * 1000).toLocaleString() : '--';
        var successCount = (h.results || []).filter(function(r) { return r.success; }).length;
        var totalCount = (h.results || []).length;
        var targetText = (h.targets || []).map(function(t) { return t.platform + '/' + t.target_id; }).join(', ');
        html += '<div class="rf-history-item">';
        html += '<div class="rf-history-header">';
        html += '<span style="font-size:13px;font-weight:600">' + date + '</span>';
        html += '<div style="display:flex;gap:6px;align-items:center">';
        html += '<span class="chip ' + (successCount === totalCount ? 'chip-ok' : 'chip-wr') + '">' + successCount + '/' + totalCount + '</span>';
        html += '<button class="btn btn-secondary btn-xs" onclick="rfResendNotify(\'' + rfEsc(h.id) + '\')">重发</button>';
        html += '</div></div>';
        html += '<div class="rf-history-targets">目标: ' + rfEsc(targetText) + '</div>';
        if (h.custom_content) {
            html += '<div style="font-size:11px;color:var(--tx-t);margin-bottom:4px">备注: ' + rfEsc(h.custom_content) + '</div>';
        }
        html += '<div class="rf-history-msg">' + rfEsc(h.message || '') + '</div>';
        html += '</div>';
    });
    el.innerHTML = html;
}

function rfResendNotify(historyId) {
    if (!_rfState.notifyActivityId) return;
    if (!confirm('确定重发此通知？')) return;
    fetch('/Raffle/api/activities/' + encodeURIComponent(_rfState.notifyActivityId) + '/notify/resend/' + encodeURIComponent(historyId), {
        method: 'POST',
        headers: _rfHeaders()
    })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.error) { alert('重发失败: ' + d.error); return; }
            alert('重发完成：成功 ' + d.success_count + '/' + d.total_count);
            rfLoadNotifyHistory(_rfState.notifyActivityId);
        })
        .catch(function(e) { alert('重发请求失败: ' + e); });
}

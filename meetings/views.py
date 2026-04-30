from django.shortcuts import render, redirect, get_object_or_404
from django.urls import reverse
from django.contrib.auth.decorators import login_required
from django.utils import timezone
from datetime import timedelta
from .models import Meeting, ActiveParticipant, SignalingMessage
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
import json

@login_required
def dashboard(request):
    if request.method == 'POST':
        action = request.POST.get('action')
        if action == 'create':
            meeting = Meeting.objects.create(host=request.user)
            return redirect('lobby', room_id=meeting.room_id)
        elif action == 'join':
            room_id = request.POST.get('room_id')
            if room_id:
                return redirect('lobby', room_id=room_id)
            
    # Only show meetings created in the last 24 hours
    time_threshold = timezone.now() - timedelta(hours=24)
    recent_meetings = Meeting.objects.filter(host=request.user, created_at__gte=time_threshold).order_by('-created_at')[:5]
    
    return render(request, 'meetings/dashboard.html', {'recent_meetings': recent_meetings})

@login_required
def lobby(request, room_id):
    meeting = get_object_or_404(Meeting, room_id=room_id)
    is_host = (request.user == meeting.host)
    return render(request, 'meetings/lobby.html', {
        'meeting': meeting,
        'room_id': str(room_id),
        'invite_link': request.build_absolute_uri(),
        'join_room_url': reverse('room', args=[room_id]),
        'is_host': is_host,
        'username': request.user.username,
    })


@login_required
def room(request, room_id):
    meeting = get_object_or_404(Meeting, room_id=room_id)
    is_host = (request.user == meeting.host)
    return render(request, 'meetings/room.html', {
        'meeting': meeting,
        'room_id': str(room_id),
        'is_host': is_host,
        'username': request.user.username,
    })

@login_required
def delete_meeting(request, room_id):
    if request.method == 'POST':
        meeting = get_object_or_404(Meeting, room_id=room_id, host=request.user)
        meeting.delete()
    return redirect('dashboard')

@login_required
@csrf_exempt
def send_signal(request, room_id):
    if request.method == 'POST':
        meeting = get_object_or_404(Meeting, room_id=room_id)
        data = json.loads(request.body)
        
        message_type = data.get('type')
        payload = data.get('payload', '')
        target_username = data.get('target')

        target_user = None
        if target_username:
            from django.contrib.auth.models import User
            try:
                target_user = User.objects.get(username=target_username)
            except User.DoesNotExist:
                pass

        SignalingMessage.objects.create(
            room=meeting,
            sender=request.user,
            target=target_user,
            message_type=message_type,
            payload=json.dumps(payload)
        )
        return JsonResponse({'status': 'ok'})
    return JsonResponse({'status': 'error'}, status=400)

@login_required
def poll_signals(request, room_id):
    meeting = get_object_or_404(Meeting, room_id=room_id)
    last_id = int(request.GET.get('last_id', 0))

    ActiveParticipant.objects.update_or_create(
        room=meeting, user=request.user,
        defaults={'last_seen': timezone.now()}
    )

    stale_threshold = timezone.now() - timedelta(seconds=15)
    ActiveParticipant.objects.filter(room=meeting, last_seen__lt=stale_threshold).delete()

    messages = SignalingMessage.objects.filter(
        room=meeting,
        id__gt=last_id
    ).exclude(sender=request.user)

    valid_messages = []
    max_id = last_id

    for msg in messages:
        if msg.target is None or msg.target == request.user:
            valid_messages.append({
                'id': msg.id,
                'type': msg.message_type,
                'sender': msg.sender.username,
                'payload': json.loads(msg.payload) if msg.payload else ''
            })
        if msg.id > max_id:
            max_id = msg.id

    active_users = list(ActiveParticipant.objects.filter(room=meeting).values_list('user__username', flat=True))

    return JsonResponse({
        'messages': valid_messages,
        'last_id': max_id,
        'active_users': active_users
    })

@login_required
@csrf_exempt
def leave_room(request, room_id):
    if request.method == 'POST':
        meeting = get_object_or_404(Meeting, room_id=room_id)
        ActiveParticipant.objects.filter(room=meeting, user=request.user).delete()
        return JsonResponse({'status': 'ok'})
    return JsonResponse({'status': 'error'}, status=400)

from django.shortcuts import render, redirect, get_object_or_404
from django.urls import reverse
from django.contrib.auth.decorators import login_required
from django.utils import timezone
from datetime import timedelta
from .models import Meeting

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

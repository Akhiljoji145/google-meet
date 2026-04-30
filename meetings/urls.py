from django.urls import path
from . import views

urlpatterns = [
    path('dashboard/', views.dashboard, name='dashboard'),
    path('lobby/<uuid:room_id>/', views.lobby, name='lobby'),
    path('room/<uuid:room_id>/', views.room, name='room'),
    path('delete/<uuid:room_id>/', views.delete_meeting, name='delete_meeting'),
    path('room/<uuid:room_id>/send_signal/', views.send_signal, name='send_signal'),
    path('room/<uuid:room_id>/poll_signals/', views.poll_signals, name='poll_signals'),
    path('room/<uuid:room_id>/leave/', views.leave_room, name='leave_room'),
]

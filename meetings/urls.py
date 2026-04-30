from django.urls import path
from . import views

urlpatterns = [
    path('dashboard/', views.dashboard, name='dashboard'),
    path('room/<uuid:room_id>/', views.room, name='room'),
    path('delete/<uuid:room_id>/', views.delete_meeting, name='delete_meeting'),
]

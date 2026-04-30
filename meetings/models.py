from django.db import models
from django.contrib.auth.models import User
import uuid

class Meeting(models.Model):
    room_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    host = models.ForeignKey(User, on_delete=models.CASCADE, related_name='hosted_meetings')
    created_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"Meeting {self.room_id} hosted by {self.host.username}"

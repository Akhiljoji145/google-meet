import json
from channels.generic.websocket import AsyncWebsocketConsumer

class MeetingConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        self.room_group_name = f'meeting_{self.room_id}'
        self.user = self.scope["user"]

        if self.user.is_anonymous:
            await self.close()
            return

        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        await self.accept()

        # Announce new peer to group
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'peer_action',
                'action': 'new_peer',
                'username': self.user.username,
                'channel_name': self.channel_name
            }
        )

    async def disconnect(self, close_code):
        if hasattr(self, 'room_group_name'):
            # Announce peer left
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'peer_action',
                    'action': 'peer_left',
                    'username': self.user.username,
                    'channel_name': self.channel_name
                }
            )
            
            # Leave room group
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )

    # Receive message from WebSocket
    async def receive(self, text_data):
        data = json.loads(text_data)
        message_type = data.get('type')
        
        if message_type == 'chat_message':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat_message',
                    'message': data['message'],
                    'username': self.user.username
                }
            )
        elif message_type in ['offer', 'answer', 'ice_candidate']:
            # P2P Signaling: Send to a specific target channel if provided, else broadcast (simplified)
            target = data.get('target')
            payload = {
                'type': 'signaling_message',
                'action': message_type,
                'data': data['data'],
                'username': self.user.username,
                'sender_channel': self.channel_name
            }
            if target:
                await self.channel_layer.send(target, payload)
            else:
                await self.channel_layer.group_send(self.room_group_name, payload)
                
        elif message_type == 'user_status':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'user_status',
                    'status': data['status'],
                    'username': self.user.username
                }
            )

    # Handlers for group_send actions
    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message': event['message'],
            'username': event['username']
        }))
        
    async def signaling_message(self, event):
        # Don't send back to sender
        if event.get('sender_channel') != self.channel_name:
            await self.send(text_data=json.dumps({
                'type': event['action'],
                'data': event['data'],
                'username': event['username'],
                'sender_channel': event['sender_channel']
            }))
            
    async def peer_action(self, event):
        if event.get('channel_name') != self.channel_name:
            await self.send(text_data=json.dumps({
                'type': event['action'],
                'username': event['username'],
                'channel_name': event['channel_name']
            }))
            
    async def user_status(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_status',
            'status': event['status'],
            'username': event['username']
        }))

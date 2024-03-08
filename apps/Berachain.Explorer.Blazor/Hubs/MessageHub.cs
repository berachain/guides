using Berachain.Explorer.Blazor.Interfaces;

namespace Berachain.Explorer.Blazor.Hubs
{
    public class MessageHub
    {
        private static readonly List<Action<IMessage>> _subscribers = [];

        public bool IsSubscribed => _subscribers.Any();

        public void Subscribe(Action<IMessage> subscriber)
        {
            _subscribers.Add(subscriber);
        }

        public void Unsubscribe(Action<IMessage> subscriber)
        {
            _subscribers.Remove(subscriber);
        }

        public void Publish(IMessage message)
        {
            foreach (var subscriber in _subscribers)
            {
                subscriber(message);
            }
        }
    }
}

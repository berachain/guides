using Berachain.Explorer.Blazor.Components;
using Berachain.Explorer.Blazor.Hubs;
using Berachain.Explorer.Blazor.Models.Configurations;
using Berachain.Explorer.Blazor.Services;
using Berachain.Explorer.Blazor.Workers;
using Microsoft.Extensions.Options;

namespace Berachain.Explorer.Blazor
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);
            var configuration = builder.Configuration;

            builder.Services.Configure<ExplorerConfiguration>(configuration.GetSection(nameof(ExplorerConfiguration)));

            // Add services to the container.
            builder.Services.AddRazorComponents()
                .AddInteractiveServerComponents();

            builder.Services.AddHostedService<LatestActionsWorker>();

            builder.Services.AddTransient<ExplorerService>();
            builder.Services.AddSingleton<MessageHub>();

            builder.Services.AddHttpClient<ExplorerService>((s, client) =>
            {
                var explorerConfiguration = s.GetRequiredService<IOptions<ExplorerConfiguration>>().Value;

                client.BaseAddress = new Uri(explorerConfiguration.ExplorerUrl);
            });

            var app = builder.Build();

            // Configure the HTTP request pipeline.
            if (!app.Environment.IsDevelopment())
            {
                app.UseExceptionHandler("/Error");
                // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
                app.UseHsts();
            }

            app.UseHttpsRedirection();

            app.UseStaticFiles();
            app.UseAntiforgery();

            app.MapRazorComponents<App>()
                .AddInteractiveServerRenderMode();

            app.Run();
        }
    }
}
